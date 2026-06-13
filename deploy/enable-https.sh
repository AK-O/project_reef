#!/usr/bin/env bash
# ProjectReef — enable Tailscale HTTPS on an existing (or freshly installed) container
#
# Run as root inside the LXC:
#   bash /opt/projectreef/deploy/enable-https.sh
# Or directly from GitHub (no prior install needed):
#   bash <(curl -fsSL https://raw.githubusercontent.com/AK-O/project_reef/main/deploy/enable-https.sh)
#
# Prerequisites:
#   1. ProjectReef already installed at /opt/projectreef
#   2. Your Tailscale account has HTTPS enabled:
#      tailscale.com/admin → DNS → Enable HTTPS certificates

set -euo pipefail

INSTALL_DIR="/opt/projectreef"
CERT_DIR="$INSTALL_DIR/certs"
APP_USER="projectreef"
SERVICE_NAME="projectreef"
ENV_FILE="$INSTALL_DIR/.env"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[projectreef]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root"
[[ ! -f "$ENV_FILE" ]] && error "ProjectReef not found at $INSTALL_DIR — run install.sh first"

# ── Tailscale install ─────────────────────────────────────────────
if ! command -v tailscale &>/dev/null; then
  info "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
else
  info "Tailscale $(tailscale version | head -1) already present"
fi

systemctl enable --now tailscaled 2>/dev/null || true

# ── Authenticate ──────────────────────────────────────────────────
if ! tailscale status &>/dev/null; then
  info "Please authenticate — follow the link below:"
  tailscale up
fi

# ── FQDN ──────────────────────────────────────────────────────────
TS_HOSTNAME=$(tailscale status --json | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
[[ -z "$TS_HOSTNAME" ]] && error "Could not determine Tailscale hostname"
info "Tailscale hostname: $TS_HOSTNAME"

# ── Fetch certificate ─────────────────────────────────────────────
info "Fetching TLS certificate..."
info "(If this fails, enable HTTPS at tailscale.com/admin → DNS → Enable HTTPS)"
mkdir -p "$CERT_DIR"
tailscale cert --cert-file "$CERT_DIR/cert.pem" --key-file "$CERT_DIR/key.pem" "$TS_HOSTNAME"
chown -R "$APP_USER:$APP_USER" "$CERT_DIR"
chmod 640 "$CERT_DIR/key.pem"
info "Certificates saved to $CERT_DIR"

# ── Current port ──────────────────────────────────────────────────
PORT=$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]')
PORT="${PORT:-8000}"

# ── Rewrite systemd service with SSL flags ────────────────────────
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=ProjectReef — self-hosted task manager
After=network.target tailscaled.service
Wants=tailscaled.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$INSTALL_DIR/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --ssl-keyfile $CERT_DIR/key.pem --ssl-certfile $CERT_DIR/cert.pem
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR/data

[Install]
WantedBy=multi-user.target
EOF

# ── Add HTTPS origin to ALLOWED_ORIGINS ──────────────────────────
TS_URL="https://$TS_HOSTNAME:$PORT"
python3 - <<PYEOF
import re

env_file = "$ENV_FILE"
ts_url   = "$TS_URL"

with open(env_file) as f:
    content = f.read()

def add_origin(m):
    origins = m.group(1)
    if ts_url in origins:
        return m.group(0)
    return f"ALLOWED_ORIGINS={origins},{ts_url}"

content = re.sub(r"ALLOWED_ORIGINS=(.*)", add_origin, content)
with open(env_file, "w") as f:
    f.write(content)
PYEOF
info "Added $TS_URL to ALLOWED_ORIGINS"

# ── Monthly cert renewal timer ────────────────────────────────────
cat > /etc/systemd/system/projectreef-cert-renew.service <<EOF
[Unit]
Description=Renew ProjectReef Tailscale TLS certificate

[Service]
Type=oneshot
ExecStart=/usr/bin/tailscale cert --cert-file $CERT_DIR/cert.pem --key-file $CERT_DIR/key.pem $TS_HOSTNAME
ExecStartPost=/bin/chown $APP_USER:$APP_USER $CERT_DIR/cert.pem $CERT_DIR/key.pem
ExecStartPost=/bin/chmod 640 $CERT_DIR/key.pem
ExecStartPost=/usr/bin/systemctl restart $SERVICE_NAME
EOF

cat > /etc/systemd/system/projectreef-cert-renew.timer <<EOF
[Unit]
Description=Monthly renewal of ProjectReef Tailscale TLS certificate

[Timer]
OnCalendar=monthly
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now projectreef-cert-renew.timer
info "Monthly cert auto-renewal scheduled"

# ── Restart service ───────────────────────────────────────────────
systemctl daemon-reload
systemctl restart "$SERVICE_NAME"

info "Waiting for service to start..."
sleep 3
STATUS=$(systemctl is-active "$SERVICE_NAME" || true)
if [[ "$STATUS" == "active" ]]; then
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  HTTPS enabled — PWA will now install as a native app!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "  URL:      https://$TS_HOSTNAME:$PORT"
  echo "  Certs:    $CERT_DIR (auto-renewed monthly)"
  echo "  Logs:     journalctl -u $SERVICE_NAME -f"
  echo ""
  echo "  On your phone:"
  echo "  1. Open the URL above in Chrome"
  echo "  2. Menu → Add to Home Screen"
  echo "  3. Launch from home screen — no Chrome UI, looks native"
  echo ""
else
  error "Service failed to restart. Check: journalctl -u $SERVICE_NAME -n 30"
fi
