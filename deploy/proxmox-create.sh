#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# ProjectReef — Proxmox LXC creator + installer
#
# Run on the PROXMOX HOST as root:
#   bash deploy/proxmox-create.sh
#
# Every setting has a default. Override via env vars for non-interactive use:
#   CT_IP=192.168.1.50/24 CT_GW=192.168.1.1 CT_PASS=secret \
#   PR_REPO=https://github.com/you/projectreef \
#   bash deploy/proxmox-create.sh
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
#  SETTINGS — edit here or export as env vars before running
# ═══════════════════════════════════════════════════════════════════════════════

# LXC container
: "${CTID:=}"                    # blank = auto-select next free ID ≥ 200
: "${CT_HOSTNAME:=projectreef}"
: "${STORAGE:=local-lvm}"        # rootfs storage pool (pve, local-lvm, …)
: "${TPL_STORAGE:=local}"        # template storage
: "${BRIDGE:=vmbr0}"             # Proxmox network bridge
: "${CT_IP:=dhcp}"               # static: 192.168.1.50/24  — or —  dhcp
: "${CT_GW:=}"                   # gateway IP (required for static; blank for DHCP)
: "${CT_DNS:=1.1.1.1 8.8.8.8}"  # nameservers, space-separated
: "${CT_RAM:=512}"               # MB
: "${CT_SWAP:=512}"              # MB — prevents OOM during pip install
: "${CT_DISK:=8}"                # GB
: "${CT_CORES:=2}"
: "${CT_PASS:=}"                 # root password — prompted if blank

# ProjectReef app
: "${PR_REPO:=}"                 # git clone URL; blank = push local files
: "${PR_PORT:=8000}"
: "${PR_HA_URL:=}"               # e.g. http://192.168.1.10:8123
: "${PR_HA_TOKEN:=}"             # Home Assistant long-lived token
: "${PR_EXTRA_ORIGIN:=}"         # extra CORS origin or Tailscale hostname

# ═══════════════════════════════════════════════════════════════════════════════

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗] ERROR:${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${CYAN}${BOLD}▶  $*${NC}"; }
hr()    { echo -e "${CYAN}────────────────────────────────────────────────────────${NC}"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v pct   >/dev/null 2>&1 || error "pct not found — run this on a Proxmox VE host"
command -v pveam >/dev/null 2>&1 || error "pveam not found — run this on a Proxmox VE host"
[[ $EUID -eq 0 ]] || error "Must run as root on the Proxmox host"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Auto-detect next free CTID ────────────────────────────────────────────────
if [[ -z "$CTID" ]]; then
  for _id in $(seq 200 299); do
    if ! pct status "$_id" &>/dev/null && ! qm status "$_id" &>/dev/null; then
      CTID=$_id; break
    fi
  done
  [[ -n "${CTID:-}" ]] || error "No free container ID in range 200–299"
  info "Auto-selected container ID: $CTID"
fi
pct status "$CTID" &>/dev/null && \
  error "Container $CTID already exists — set CTID= to a different value"

# ── Prompt for password ───────────────────────────────────────────────────────
if [[ -z "$CT_PASS" ]]; then
  echo ""
  while true; do
    read -rsp "  Root password for container $CTID: " CT_PASS; echo
    [[ -z "$CT_PASS" ]] && { warn "Password cannot be empty"; continue; }
    read -rsp "  Confirm password: " _confirm; echo
    [[ "$CT_PASS" == "$_confirm" ]] && break
    warn "Passwords don't match — try again"
  done
fi

# ── Find or download Ubuntu template ─────────────────────────────────────────
# Prefer 24.04 (Python 3.12 built-in), fall back to 22.04
step "Resolving Ubuntu LXC template"

_find_local_tpl() {
  # pveam list output: "storage:vztmpl/name.tar.zst   size   date"
  pveam list "$TPL_STORAGE" 2>/dev/null \
    | awk '{print $1}' \
    | sed 's|.*vztmpl/||' \
    | grep -i "ubuntu-${1}" | head -1 || true
}

_download_tpl() {
  local name
  name=$(pveam available --section system 2>/dev/null \
    | awk '{print $2}' | grep -i "ubuntu-${1}" | grep "standard" | head -1 || true)
  [[ -z "$name" ]] && return 1
  info "Downloading: $name"
  pveam download "$TPL_STORAGE" "$name" >/dev/null
  echo "$name"
}

TEMPLATE_NAME="" UBUNTU_VER=""
for _ver in 24.04 22.04; do
  TEMPLATE_NAME=$(_find_local_tpl "$_ver")
  if [[ -n "$TEMPLATE_NAME" ]]; then
    UBUNTU_VER=$_ver
    info "Found local template: $TEMPLATE_NAME (Ubuntu $UBUNTU_VER)"
    break
  fi
done

if [[ -z "$TEMPLATE_NAME" ]]; then
  warn "No local Ubuntu template found — downloading (run 'pveam update' first if this fails)"
  for _ver in 24.04 22.04; do
    TEMPLATE_NAME=$(_download_tpl "$_ver" || true)
    if [[ -n "$TEMPLATE_NAME" ]]; then
      UBUNTU_VER=$_ver; break
    fi
  done
fi

[[ -n "$TEMPLATE_NAME" ]] || error \
  "No Ubuntu template available. Run: pveam update"

info "Template: $TEMPLATE_NAME"

# ── Build network string ───────────────────────────────────────────────────────
CT_IP_LOWER="${CT_IP,,}"
if [[ "$CT_IP_LOWER" == "dhcp" || -z "$CT_IP" ]]; then
  NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=dhcp,ip6=auto"
else
  [[ -z "$CT_GW" ]] && warn "CT_GW not set for static IP — container may not reach the internet"
  GW_PART="${CT_GW:+,gw=${CT_GW}}"
  NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=${CT_IP}${GW_PART}"
fi

# ── Create container ──────────────────────────────────────────────────────────
step "Creating LXC container $CTID ($CT_HOSTNAME)"

pct create "$CTID" "${TPL_STORAGE}:vztmpl/${TEMPLATE_NAME}" \
  --hostname    "$CT_HOSTNAME"          \
  --storage     "$STORAGE"              \
  --rootfs      "${STORAGE}:${CT_DISK}" \
  --memory      "$CT_RAM"               \
  --swap        "$CT_SWAP"              \
  --cores       "$CT_CORES"             \
  --net0        "$NET_CONFIG"           \
  --nameserver  "$CT_DNS"               \
  --password    "$CT_PASS"              \
  --unprivileged 1                      \
  --features    nesting=1               \
  --onboot      1

info "Container created — starting..."
pct start "$CTID"

# ── Wait for container init to accept commands ────────────────────────────────
step "Waiting for container to boot"
_timeout=90; _elapsed=0
until pct exec "$CTID" -- true 2>/dev/null; do
  sleep 2; ((_elapsed += 2))
  (( _elapsed % 10 == 0 )) && info "  still waiting... (${_elapsed}s)"
  [[ $_elapsed -ge $_timeout ]] && \
    error "Container unreachable after ${_timeout}s — check: pct log $CTID"
done
info "Container init ready (${_elapsed}s)"

# ── Wait for network ──────────────────────────────────────────────────────────
step "Waiting for network"

# Step 1: wait for eth0 to have an IP (DHCP can take 10–30s)
_timeout=90; _elapsed=0
until pct exec "$CTID" -- \
    bash -c 'ip -4 addr show eth0 2>/dev/null | grep -q "inet "' 2>/dev/null; do
  sleep 3; ((_elapsed += 3))
  (( _elapsed % 15 == 0 )) && info "  waiting for IP... (${_elapsed}s)"
  if [[ $_elapsed -ge $_timeout ]]; then
    error "No IP on eth0 after ${_timeout}s.
  Likely causes:
    • Bridge '$BRIDGE' has no DHCP server, or the range is exhausted
    • Wrong bridge name — check: pct config $CTID
    • Try setting a static IP: CT_IP=192.168.x.x/24 CT_GW=192.168.x.1"
  fi
done

CT_ACTUAL_IP=$(pct exec "$CTID" -- \
  bash -c "ip -4 addr show eth0 | awk '/inet /{print \$2}' | cut -d/ -f1" 2>/dev/null || echo "?")
info "Got IP: $CT_ACTUAL_IP"

# Step 2: verify DNS resolves (proves nameserver config works)
_timeout=45; _elapsed=0
_dns_ok=false
until $( pct exec "$CTID" -- \
    bash -c 'getent hosts archive.ubuntu.com >/dev/null 2>&1' 2>/dev/null ); do
  sleep 3; ((_elapsed += 3))
  if [[ $_elapsed -ge 20 && $_dns_ok == false ]]; then
    warn "DNS not resolving after 20s — injecting fallback resolv.conf..."
    pct exec "$CTID" -- \
      bash -c 'printf "nameserver 1.1.1.1\nnameserver 8.8.8.8\n" > /etc/resolv.conf'
    _dns_ok=true
    sleep 3
    pct exec "$CTID" -- \
      bash -c 'getent hosts archive.ubuntu.com >/dev/null 2>&1' 2>/dev/null && break
  fi
  if [[ $_elapsed -ge $_timeout ]]; then
    error "DNS not working after ${_timeout}s (IP=$CT_ACTUAL_IP).
  The container has a network address but cannot resolve hostnames.
  Check: CT_DNS setting, bridge forwarding, Proxmox host firewall."
  fi
done
info "DNS working — internet reachable"

# ── Push install config (properly quoted) ─────────────────────────────────────
step "Deploying ProjectReef"

_CONFIG=$(mktemp)
{
  printf 'export PROJECTREEF_REPO=%q\n'         "$PR_REPO"
  printf 'export PROJECTREEF_PORT=%q\n'         "$PR_PORT"
  printf 'export PROJECTREEF_HA_URL=%q\n'       "$PR_HA_URL"
  printf 'export PROJECTREEF_HA_TOKEN=%q\n'     "$PR_HA_TOKEN"
  printf 'export PROJECTREEF_EXTRA_ORIGIN=%q\n' "$PR_EXTRA_ORIGIN"
} > "$_CONFIG"
pct push "$CTID" "$_CONFIG" /tmp/reef-env.sh
rm -f "$_CONFIG"

# ── Push code ─────────────────────────────────────────────────────────────────
if [[ -n "$PR_REPO" ]]; then
  info "Will clone from: $PR_REPO"

  _LAUNCHER=$(mktemp)
  cat > "$_LAUNCHER" <<'LAUNCH_EOF'
#!/usr/bin/env bash
set -euo pipefail
source /tmp/reef-env.sh
apt-get update -qq
apt-get install -y --no-install-recommends git curl -qq
git clone "$PROJECTREEF_REPO" /tmp/projectreef-src
bash /tmp/projectreef-src/deploy/install.sh
LAUNCH_EOF

else
  info "Archiving local project files..."
  _TMPTAR=$(mktemp /tmp/projectreef-XXXXXX.tar.gz)
  tar czf "$_TMPTAR" \
    --exclude='.venv'       \
    --exclude='__pycache__' \
    --exclude='*.pyc'       \
    --exclude='.env'        \
    --exclude='data'        \
    --exclude='.git'        \
    -C "$SCRIPT_DIR" .
  pct push "$CTID" "$_TMPTAR" /tmp/projectreef.tar.gz
  rm -f "$_TMPTAR"

  _LAUNCHER=$(mktemp)
  cat > "$_LAUNCHER" <<'LAUNCH_EOF'
#!/usr/bin/env bash
set -euo pipefail
source /tmp/reef-env.sh
apt-get update -qq
apt-get install -y --no-install-recommends curl rsync -qq
mkdir -p /tmp/projectreef-src
tar xzf /tmp/projectreef.tar.gz -C /tmp/projectreef-src
bash /tmp/projectreef-src/deploy/install.sh
LAUNCH_EOF
fi

pct push "$CTID" "$_LAUNCHER" /tmp/reef-launch.sh
rm -f "$_LAUNCHER"

# ── Run the installer (output streams live to the terminal) ───────────────────
pct exec "$CTID" -- bash /tmp/reef-launch.sh

# ── Summary ───────────────────────────────────────────────────────────────────
CT_ACTUAL_IP=$(pct exec "$CTID" -- \
  bash -c "ip -4 addr show eth0 2>/dev/null | awk '/inet /{print \$2}' | cut -d/ -f1" \
  2>/dev/null || echo "$CT_ACTUAL_IP")

echo ""
hr
echo -e "${GREEN}${BOLD}  ProjectReef is live!${NC}"
hr
printf "\n"
printf "  %-16s %s\n" "Container:"  "$CTID  ($CT_HOSTNAME)"
printf "  %-16s %s\n" "IP address:" "$CT_ACTUAL_IP"
printf "  %-16s %s\n" "App URL:"    "http://${CT_ACTUAL_IP}:${PR_PORT}"
printf "\n"
echo "  Manage:"
printf "  %-58s  %s\n" "  pct enter $CTID"                                          "# shell in container"
printf "  %-58s  %s\n" "  pct exec  $CTID -- journalctl -u projectreef -f"          "# live logs"
printf "  %-58s  %s\n" "  pct exec  $CTID -- bash /opt/projectreef/deploy/update.sh" "# update app"
printf "\n"
echo "  Next steps:"
echo "  1. Open http://${CT_ACTUAL_IP}:${PR_PORT} — register your account"
echo "  2. Profile → API Token — copy this for Claude Desktop MCP"
echo "  3. Add to Claude Desktop config:"
echo "       PROJECTREEF_URL=http://${CT_ACTUAL_IP}:${PR_PORT}"
echo "       PROJECTREEF_TOKEN=<your api token>"
printf "\n"
