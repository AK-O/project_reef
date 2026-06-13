#!/usr/bin/env bash
# ProjectReef — one-shot installer for Ubuntu 22.04 / 24.04 LXC
# Run inside the LXC container as root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/AK-O/project_reef/main/deploy/install.sh)
# Or locally after cloning:
#   sudo bash deploy/install.sh

set -euo pipefail

# Source config injected by proxmox-create.sh (no-op for standalone installs)
if [[ -f /tmp/reef-env.sh ]]; then
  source /tmp/reef-env.sh
  rm -f /tmp/reef-env.sh
fi

# ── Config ────────────────────────────────────────────────────────
REPO_URL="${PROJECTREEF_REPO:-}"        # set via env or prompted below
INSTALL_DIR="/opt/projectreef"
DATA_DIR="$INSTALL_DIR/data"
APP_USER="projectreef"
SERVICE_NAME="projectreef"
PYTHON=""  # resolved below

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[projectreef]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── Root check ────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root (sudo bash install.sh)"

# ── Gather inputs ─────────────────────────────────────────────────
if [[ -z "$REPO_URL" ]]; then
  read -rp "Git repo URL (leave blank to use files in current directory): " REPO_URL
fi

# Allow env-var overrides for non-interactive (e.g. proxmox-create.sh) installs.
# Set PROJECTREEF_PORT, PROJECTREEF_HA_URL, PROJECTREEF_HA_TOKEN,
# PROJECTREEF_EXTRA_ORIGIN before calling this script to skip all prompts.
if [[ -n "${PROJECTREEF_PORT:-}" ]]; then
  PORT="$PROJECTREEF_PORT"
else
  read -rp "Port to listen on [8000]: " PORT
  PORT="${PORT:-8000}"
fi

if [[ -n "${PROJECTREEF_HA_URL:-}" ]]; then
  HA_URL="$PROJECTREEF_HA_URL"
  HA_TOKEN="${PROJECTREEF_HA_TOKEN:-}"
else
  read -rp "Home Assistant URL (blank to skip): " HA_URL
  if [[ -n "$HA_URL" ]]; then
    read -rp "Home Assistant long-lived token: " HA_TOKEN
  else
    HA_TOKEN=""
  fi
fi

if [[ -n "${PROJECTREEF_EXTRA_ORIGIN:-}" ]]; then
  EXTRA_ORIGIN="$PROJECTREEF_EXTRA_ORIGIN"
else
  read -rp "Tailscale hostname or extra origin (blank to skip): " EXTRA_ORIGIN
fi

# ── System packages ───────────────────────────────────────────────
info "Updating packages..."
apt-get update -qq
apt-get install -y --no-install-recommends git curl -qq

# Resolve Python 3.12 — Ubuntu 24.04 ships it in main; 22.04 needs deadsnakes
if command -v python3.12 &>/dev/null && python3.12 -m venv --help &>/dev/null 2>&1; then
  PYTHON=python3.12
  info "Python 3.12 already present"
elif command -v python3.12 &>/dev/null; then
  apt-get install -y python3.12-venv -qq
  PYTHON=python3.12
  info "Python 3.12 present (installed venv support)"
else
  info "Installing Python 3.12..."
  # Try main repo first (works on Ubuntu 24.04+), then deadsnakes (for 22.04)
  if apt-get install -y python3.12 python3.12-venv python3.12-dev -qq 2>/dev/null; then
    PYTHON=python3.12
  else
    apt-get install -y software-properties-common -qq
    add-apt-repository -y ppa:deadsnakes/ppa
    apt-get update -qq
    apt-get install -y python3.12 python3.12-venv python3.12-dev -qq
    PYTHON=python3.12
  fi
fi
info "Using: $($PYTHON --version)"

# ── App user ──────────────────────────────────────────────────────
if ! id "$APP_USER" &>/dev/null; then
  info "Creating user $APP_USER..."
  useradd -r -s /usr/sbin/nologin -d "$INSTALL_DIR" "$APP_USER"
fi

# ── Deploy code ───────────────────────────────────────────────────
if [[ -n "$REPO_URL" ]]; then
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Updating existing repo..."
    git -C "$INSTALL_DIR" pull
  else
    info "Cloning $REPO_URL..."
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
else
  # Local install — copy from current directory
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ "$SCRIPT_DIR" != "$INSTALL_DIR" ]]; then
    info "Copying files from $SCRIPT_DIR to $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"
    rsync -a --exclude='.venv' --exclude='__pycache__' \
      --exclude='*.pyc' --exclude='.env' --exclude='data/' \
      "$SCRIPT_DIR/" "$INSTALL_DIR/"
  fi
fi

mkdir -p "$DATA_DIR"

# ── Virtual environment ───────────────────────────────────────────
info "Setting up Python virtual environment..."
if [[ ! -d "$INSTALL_DIR/.venv" ]]; then
  $PYTHON -m venv "$INSTALL_DIR/.venv"
fi
"$INSTALL_DIR/.venv/bin/pip" install --upgrade pip -q
"$INSTALL_DIR/.venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt" -q
info "Dependencies installed"

# ── .env file ─────────────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Generating .env..."
  SECRET_KEY=$("$INSTALL_DIR/.venv/bin/python" -c "import secrets; print(secrets.token_hex(32))")

  ORIGINS="http://localhost:$PORT"
  LXC_IP=$(hostname -I | awk '{print $1}')
  [[ -n "$LXC_IP" ]] && ORIGINS="$ORIGINS,http://$LXC_IP:$PORT"
  [[ -n "$EXTRA_ORIGIN" ]] && ORIGINS="$ORIGINS,https://$EXTRA_ORIGIN"

  cat > "$ENV_FILE" <<EOF
SECRET_KEY=$SECRET_KEY
DATABASE_URL=sqlite:////opt/projectreef/data/projectreef.db
HA_URL=$HA_URL
HA_TOKEN=$HA_TOKEN
PORT=$PORT
ALLOWED_ORIGINS=$ORIGINS
EOF
  info ".env created"
else
  warn ".env already exists — skipping (edit manually if needed)"
fi

# ── Permissions ───────────────────────────────────────────────────
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
chmod 600 "$ENV_FILE"

# ── systemd service ───────────────────────────────────────────────
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=ProjectReef — self-hosted task manager
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$INSTALL_DIR/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── Log rotation ──────────────────────────────────────────────────
cat > "/etc/logrotate.d/$SERVICE_NAME" <<EOF
/var/log/journal {
    weekly
    rotate 4
    compress
    missingok
    notifempty
}
EOF

# ── Health check ──────────────────────────────────────────────────
info "Waiting for service to start..."
sleep 3
for i in {1..10}; do
  if curl -sf "http://localhost:$PORT/health" &>/dev/null; then
    break
  fi
  sleep 2
done

STATUS=$(systemctl is-active "$SERVICE_NAME" || true)
if [[ "$STATUS" == "active" ]]; then
  LXC_IP=$(hostname -I | awk '{print $1}')
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ProjectReef installed successfully!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  URL:    http://$LXC_IP:$PORT"
  echo "  Logs:   journalctl -u $SERVICE_NAME -f"
  echo "  Stop:   systemctl stop $SERVICE_NAME"
  echo ""
  echo "  Next steps:"
  echo "  1. Open the URL and register your account"
  echo "  2. Go to Profile → API Token to get your MCP token"
  echo "  3. Add the MCP server to Claude Desktop (see README)"
  echo ""

  # ── Optional: Tailscale HTTPS ──────────────────────────────────
  if [[ -z "${PROJECTREEF_TAILSCALE:-}" ]]; then
    read -rp "Set up Tailscale HTTPS now? (enables PWA standalone mode) [y/N]: " PROJECTREEF_TAILSCALE
  fi
  if [[ "${PROJECTREEF_TAILSCALE,,}" =~ ^y ]]; then
    bash "$INSTALL_DIR/deploy/enable-https.sh"
  fi
else
  error "Service did not start. Check: journalctl -u $SERVICE_NAME -n 50"
fi
