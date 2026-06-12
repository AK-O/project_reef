#!/usr/bin/env bash
# ProjectReef — in-place updater
# Run inside the LXC as root: sudo bash /opt/projectreef/deploy/update.sh

set -euo pipefail

INSTALL_DIR="/opt/projectreef"
SERVICE_NAME="projectreef"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[projectreef]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "Run as root"

cd "$INSTALL_DIR"

# Show current version before update
BEFORE=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
info "Current commit: $BEFORE"

info "Pulling latest code..."
git pull

AFTER=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

if [[ "$BEFORE" == "$AFTER" ]]; then
  info "Already up to date ($AFTER) — restarting anyway to apply any env changes"
else
  info "Updated $BEFORE → $AFTER"
fi

info "Syncing dependencies..."
.venv/bin/pip install -r requirements.txt -q

info "Restarting service..."
systemctl restart "$SERVICE_NAME"
sleep 2

STATUS=$(systemctl is-active "$SERVICE_NAME" || true)
if [[ "$STATUS" == "active" ]]; then
  info "Service running ($(git rev-parse --short HEAD))"
else
  error "Service failed to start after update — check: journalctl -u $SERVICE_NAME -n 50"
fi
