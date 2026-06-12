#!/usr/bin/env bash
# ProjectReef — Proxmox LXC creator
#
# Run this on the PROXMOX HOST (not inside any container):
#   bash deploy/proxmox-create.sh
#
# To skip the git-clone prompt, set PROJECTREEF_REPO beforehand:
#   PROJECTREEF_REPO=https://github.com/AK-O/project_reef bash deploy/proxmox-create.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[projectreef]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }
step()  { echo -e "\n${CYAN}▶ $*${NC}"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v pct    >/dev/null 2>&1 || error "This script must run on a Proxmox VE host (pct not found)"
command -v pveam  >/dev/null 2>&1 || error "pveam not found — is this Proxmox VE?"
[[ $EUID -ne 0 ]] && error "Run as root on the Proxmox host"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Gather inputs ─────────────────────────────────────────────────────────────
step "Container configuration"

read -rp "  Container ID [200]: "                    CTID;         CTID="${CTID:-200}"
read -rp "  Hostname [projectreef]: "                CT_HOSTNAME;  CT_HOSTNAME="${CT_HOSTNAME:-projectreef}"
read -rp "  Storage pool [local-lvm]: "              STORAGE;      STORAGE="${STORAGE:-local-lvm}"
read -rp "  Template storage [local]: "              TPL_STORAGE;  TPL_STORAGE="${TPL_STORAGE:-local}"
read -rp "  Network bridge [vmbr0]: "                BRIDGE;       BRIDGE="${BRIDGE:-vmbr0}"
read -rp "  IP/CIDR (e.g. 192.168.1.50/24 or dhcp): " CT_IP
read -rp "  Gateway (blank if DHCP): "               CT_GW
read -rp "  RAM in MB [512]: "                       CT_RAM;       CT_RAM="${CT_RAM:-512}"
read -rp "  Disk size in GB [8]: "                   CT_DISK;      CT_DISK="${CT_DISK:-8}"
read -rp "  vCPU cores [2]: "                        CT_CORES;     CT_CORES="${CT_CORES:-2}"
read -rp "  Root password for container: "           CT_PASS
echo ""

step "ProjectReef configuration"

REPO_URL="${PROJECTREEF_REPO:-}"
if [[ -z "$REPO_URL" ]]; then
  read -rp "  Git repo URL (blank to push local files): " REPO_URL
fi

read -rp "  Port [8000]: "                                   PR_PORT;   PR_PORT="${PR_PORT:-8000}"
read -rp "  Home Assistant URL (blank to skip): "            PR_HA_URL
if [[ -n "$PR_HA_URL" ]]; then
  read -rp "  Home Assistant token: "                        PR_HA_TOKEN
else
  PR_HA_TOKEN=""
fi
read -rp "  Extra CORS origin / Tailscale hostname (blank to skip): " PR_EXTRA_ORIGIN
echo ""

# ── Check container ID is free ────────────────────────────────────────────────
if pct status "$CTID" &>/dev/null; then
  error "Container $CTID already exists. Choose a different ID."
fi

# ── Find or download Ubuntu 22.04 template ────────────────────────────────────
step "Resolving Ubuntu 22.04 template"

TEMPLATE_NAME=""
# Check if already downloaded
while IFS= read -r line; do
  if echo "$line" | grep -qi "ubuntu-22.04"; then
    TEMPLATE_NAME=$(echo "$line" | awk '{print $1}' | xargs basename)
    break
  fi
done < <(pveam list "$TPL_STORAGE" 2>/dev/null || true)

if [[ -z "$TEMPLATE_NAME" ]]; then
  info "Template not found locally — searching available templates..."
  TEMPLATE_NAME=$(pveam available --section system 2>/dev/null \
    | grep -i "ubuntu-22.04" | head -1 | awk '{print $2}')
  [[ -z "$TEMPLATE_NAME" ]] && error "Could not find an Ubuntu 22.04 template. Run: pveam update"
  info "Downloading $TEMPLATE_NAME..."
  pveam download "$TPL_STORAGE" "$TEMPLATE_NAME"
fi

info "Using template: $TEMPLATE_NAME"

# ── Build network string ───────────────────────────────────────────────────────
if [[ "$CT_IP" == "dhcp" || -z "$CT_IP" ]]; then
  NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=dhcp"
else
  GW_PART=""
  [[ -n "$CT_GW" ]] && GW_PART=",gw=${CT_GW}"
  NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=${CT_IP}${GW_PART}"
fi

# ── Create container ──────────────────────────────────────────────────────────
step "Creating LXC container $CTID"

pct create "$CTID" "${TPL_STORAGE}:vztmpl/${TEMPLATE_NAME}" \
  --hostname   "$CT_HOSTNAME" \
  --storage    "$STORAGE" \
  --rootfs     "${STORAGE}:${CT_DISK}" \
  --memory     "$CT_RAM" \
  --cores      "$CT_CORES" \
  --net0       "$NET_CONFIG" \
  --password   "$CT_PASS" \
  --unprivileged 1 \
  --features   nesting=1 \
  --onboot     1

info "Starting container..."
pct start "$CTID"

# Wait until running
for i in {1..15}; do
  [[ "$(pct status "$CTID" | awk '{print $2}')" == "running" ]] && break
  sleep 2
done
[[ "$(pct status "$CTID" | awk '{print $2}')" == "running" ]] || error "Container failed to start"

# Wait for network
info "Waiting for network..."
for i in {1..20}; do
  if pct exec "$CTID" -- ping -c1 -W2 1.1.1.1 &>/dev/null; then
    info "Network is up"
    break
  fi
  sleep 3
done

# ── Deploy ProjectReef ────────────────────────────────────────────────────────
step "Deploying ProjectReef"

# Build env block to pass to install.sh (non-interactive mode)
INSTALL_ENV="PROJECTREEF_PORT='${PR_PORT}' PROJECTREEF_HA_URL='${PR_HA_URL}' PROJECTREEF_HA_TOKEN='${PR_HA_TOKEN}' PROJECTREEF_EXTRA_ORIGIN='${PR_EXTRA_ORIGIN}'"

if [[ -n "$REPO_URL" ]]; then
  # Clone from git inside the container, then run install.sh
  info "Installing from git repo: $REPO_URL"
  pct exec "$CTID" -- bash -c "
    set -e
    apt-get update -qq
    apt-get install -y --no-install-recommends git curl -qq
    git clone '${REPO_URL}' /tmp/projectreef-src
    export PROJECTREEF_REPO='${REPO_URL}'
    export ${INSTALL_ENV}
    bash /tmp/projectreef-src/deploy/install.sh
  "
else
  # No repo URL — archive and push local files
  info "Pushing local files to container (no repo URL provided)..."
  TMPTAR=$(mktemp /tmp/projectreef-XXXXXX.tar.gz)
  tar czf "$TMPTAR" \
    --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='.env'  --exclude='data/'       --exclude='.git' \
    -C "$SCRIPT_DIR" .
  pct push "$CTID" "$TMPTAR" /tmp/projectreef.tar.gz
  rm -f "$TMPTAR"

  pct exec "$CTID" -- bash -c "
    set -e
    apt-get update -qq
    apt-get install -y --no-install-recommends curl -qq
    mkdir -p /tmp/projectreef-src
    tar xzf /tmp/projectreef.tar.gz -C /tmp/projectreef-src
    export ${INSTALL_ENV}
    bash /tmp/projectreef-src/deploy/install.sh
  "
fi

# ── Done ──────────────────────────────────────────────────────────────────────
CT_ACTUAL_IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || echo "?")

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Proxmox LXC created and ProjectReef installed!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Container ID : $CTID"
echo "  Hostname     : $CT_HOSTNAME"
echo "  IP           : $CT_ACTUAL_IP"
echo "  URL          : http://$CT_ACTUAL_IP:${PR_PORT}"
echo ""
echo "  Manage:  pct start/stop/enter $CTID"
echo "  Logs:    pct exec $CTID -- journalctl -u projectreef -f"
echo "  Update:  pct exec $CTID -- bash /opt/projectreef/deploy/update.sh"
echo ""
