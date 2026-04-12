#!/bin/bash
# setup-dashboard.sh — Provision the ninja-ops dashboard in an LXC container
# Self-contained: can be curl-piped or run from the scripts/ directory.
#
# The dashboard is built on the control plane container (which already has
# pnpm and the repo), then the dist/ folder is transferred here and served
# by `serve`. No build tooling needed in this container — just Node.js.
#
# Usage:
#   bash setup-dashboard.sh [--yes] [--force] [--help]
#   VITE_API_URL=http://10.0.0.20:3000 bash setup-dashboard.sh --yes
#
# Run setup-control-plane.sh first.

set -euo pipefail

# ── Source common.sh if available, otherwise define inline fallbacks ─────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo ".")"
[ -f "$SCRIPT_DIR/common.sh" ] && . "$SCRIPT_DIR/common.sh"

if [ "${_NINJA_COMMON_LOADED:-}" != "1" ]; then
  if [ -t 1 ] && [ -n "${TERM:-}" ] && [ "${TERM:-}" != "dumb" ]; then
    C_RED=$(printf '\033[0;31m'); C_GRN=$(printf '\033[0;32m')
    C_YLW=$(printf '\033[0;33m'); C_CYN=$(printf '\033[0;36m')
    C_BLD=$(printf '\033[1m');    C_RST=$(printf '\033[0m')
  else
    C_RED=''; C_GRN=''; C_YLW=''; C_CYN=''; C_BLD=''; C_RST=''
  fi
  log_info() { printf '%s[ninja]%s %s\n'          "$C_CYN" "$C_RST" "$1"; }
  log_ok()   { printf '%s[ninja]%s %s✓%s %s\n'   "$C_CYN" "$C_RST" "$C_GRN" "$C_RST" "$1"; }
  log_warn() { printf '%s[ninja]%s %s⚠%s  %s\n'  "$C_CYN" "$C_RST" "$C_YLW" "$C_RST" "$1"; }
  log_fail() { printf '%s[ninja]%s %s✗%s %s\n'   "$C_CYN" "$C_RST" "$C_RED" "$C_RST" "$1" >&2; }
  die()      { log_fail "$1"; exit 1; }
  check_proxmox_host() {
    command -v pct  >/dev/null 2>&1 || die "pct not found — run this on a Proxmox VE host"
    command -v pvesh >/dev/null 2>&1 || die "pvesh not found — run this on a Proxmox VE host"
  }
  find_latest_template() { pveam available --section system | grep "$1" | sort -V | tail -1 | awk '{print $2}'; }
  download_template() { pveam list "$1" | grep -q "$2" || pveam download "$1" "$2"; }
  create_lxc() {
    if pct status "$CT_ID" >/dev/null 2>&1; then
      log_warn "CT $CT_ID already exists — skipping create"
    else
      _net_args="name=eth0,bridge=${NET_BRIDGE},ip=${NET_IP}"
      [ "$NET_IP" != "dhcp" ] && _net_args="${_net_args},gw=${NET_GW}"
      pct create "$CT_ID" "${CT_TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
        --hostname "$CT_HOSTNAME" --storage "$CT_STORAGE" \
        --rootfs "${CT_STORAGE}:${CT_DISK}" --memory "$CT_MEMORY" \
        --swap "$CT_SWAP" --cores "$CT_CORES" \
        --net0 "$_net_args" \
        --nameserver "$NET_DNS" --unprivileged 1 --features nesting=1 --start 1
    fi
    pct status "$CT_ID" | grep -q running || pct start "$CT_ID"
    local i=0
    while [ "$i" -lt 30 ]; do
      pct exec "$CT_ID" -- ping -c1 -W1 8.8.8.8 >/dev/null 2>&1 && break
      sleep 2; i=$((i + 1))
    done
    [ "$i" -lt 30 ] || die "CT $CT_ID did not get network after 60s"
    if [ "$NET_IP" = "dhcp" ]; then
      log_info "Detecting DHCP-assigned IP for CT $CT_ID..."
      sleep 2
      NET_IP=$(pct exec "$CT_ID" -- ip -4 addr show eth0 | awk '/inet / {print $2}' | head -1)
      NET_GW=$(pct exec "$CT_ID" -- ip route show default | awk '{print $3}' | head -1)
      [ -n "$NET_IP" ] || die "Failed to detect DHCP-assigned IP for CT $CT_ID"
      log_ok "DHCP assigned: $NET_IP (gw $NET_GW)"
      pct set "$CT_ID" --net0 "name=eth0,bridge=${NET_BRIDGE},ip=${NET_IP},gw=${NET_GW}"
      log_ok "Container IP set to static: $NET_IP"
    fi
  }
  exec_ct() { pct exec "$1" -- bash -c "$2"; }
  install_base_packages() {
    exec_ct "$1" "apt-get update -qq && apt-get upgrade -y -qq && \
      apt-get install -y -qq curl wget gnupg ca-certificates sudo htop lsb-release"
  }
  configure_locale_timezone() {
    exec_ct "$1" "ln -sf /usr/share/zoneinfo/$2 /etc/localtime && \
      dpkg-reconfigure -f noninteractive tzdata && \
      apt-get install -y -qq locales && \
      sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen"
  }
  strip_cidr() { printf '%s' "${1%%/*}"; }
  OPT_YES=${OPT_YES:-0}; OPT_FORCE=${OPT_FORCE:-0}
  _BOX_INNER=68
  _print_n_chars() { local _c="$1" _n="$2" _i=0; while [ "$_i" -lt "$_n" ]; do printf '%s' "$_c"; _i=$((_i+1)); done; }
  print_box_top() { printf '╔'; _print_n_chars '═' "$_BOX_INNER"; printf '╗\n'; }
  print_box_mid() { printf '╠'; _print_n_chars '═' "$_BOX_INNER"; printf '╣\n'; }
  print_box_bot() { printf '╚'; _print_n_chars '═' "$_BOX_INNER"; printf '╝\n'; }
  print_box_title() { local _t="$1" _pad_l=$(( (_BOX_INNER - ${#1}) / 2 )) _pad_r=$(( _BOX_INNER - ${#1} - (_BOX_INNER - ${#1}) / 2 )); printf '║'; _print_n_chars ' ' "$_pad_l"; printf '%s' "$_t"; _print_n_chars ' ' "$_pad_r"; printf '║\n'; }
  print_box_blank() { printf '║\n'; }
  print_box_kv() { printf '║  %s =\n║    %s\n' "$1" "$2"; }
  prompt_default() {
    local _hint=""
    [ -n "${3:-}" ] && _hint=" ${C_YLW}(e.g. $3)${C_RST}"
    printf '%s[ninja]%s %s [%s]%s: ' "$C_CYN" "$C_RST" "$1" "$2" "$_hint" >/dev/tty
    read -r REPLY </dev/tty; [ -z "$REPLY" ] && REPLY="$2"
  }
  confirm_settings() {
    local _title="$1"; shift; printf '\n'; print_box_top; print_box_title "$_title"; print_box_mid; print_box_blank
    for _kv in "$@"; do print_box_kv "${_kv%%=*}" "${_kv#*=}"; done
    print_box_blank; print_box_bot; printf '\n'
    if [ "${OPT_YES:-0}" -eq 1 ]; then log_info "Proceeding (--yes)"; return 0; fi
    printf '%sProceed with these settings? [Y/n]:%s ' "$C_YLW" "$C_RST" >/dev/tty; read -r _c </dev/tty
    case "$_c" in n|N|no|NO) die "Aborted." ;; *) return 0 ;; esac
  }
fi

# ── Help ─────────────────────────────────────────────────────────────────────
show_help() {
  cat <<'EOF'
Usage: setup-dashboard.sh [OPTIONS]

Provision the ninja-ops dashboard in an LXC container on Proxmox VE.

The dashboard is built on the control plane container (CT_CP_ID), then
dist/ is transferred to this container and served by `serve` on port 8080.
Run setup-control-plane.sh before this script.

Options:
  --yes, -y    Skip confirmation prompt
  --force      Recreate container if it already exists
  --help, -h   Show this help message

Environment variables (all optional):
  CT_ID              Dashboard container ID (default: 203)
  CT_HOSTNAME        Hostname (default: dashboard-01)
  CT_STORAGE         Storage pool (default: local-lvm)
  CT_DISK            Disk size in GB (default: 4)
  CT_MEMORY          Memory in MB (default: 512)
  CT_SWAP            Swap in MB (default: 256)
  CT_CORES           CPU cores (default: 1)
  CT_TEMPLATE_STORAGE  Template storage (default: local)
  CT_TEMPLATE_DISTRO   Distro pattern (default: debian-12)
  NET_BRIDGE         Network bridge (default: vmbr0)
  NET_IP             IP with CIDR (default: 10.0.0.21/24)
  NET_GW             Gateway (default: 10.0.0.1)
  NET_DNS            DNS server (default: 1.1.1.1)
  CT_CP_ID           Control plane container to build on (default: 202)
  CP_INSTALL_DIR     Repo path on the control plane CT (default: /opt/ninja-ops)
  CP_SERVICE_USER    Service user on the control plane CT (default: ninja)
  VITE_API_URL       Control plane URL baked into the bundle (default: http://10.0.0.20:3000)
  DASH_DIR           Directory to serve from in this container (default: /opt/dashboard)
  SERVE_PORT         Port serve listens on (default: 8080)
  SERVICE_USER       System user in this container (default: ninja)
  NODE_VERSION       Node.js version (default: 22)
  TZ                 Timezone (default: Pacific/Auckland)
EOF
}

# ── Parse flags ──────────────────────────────────────────────────────────────
for _arg in "$@"; do
  case "$_arg" in
    --yes|-y)    OPT_YES=1 ;;
    --force)     OPT_FORCE=1 ;;
    --use-env)   OPT_USE_ENV=1 ;;
    --help|-h)   show_help; exit 0 ;;
    *) die "Unknown option: $_arg (use --help)" ;;
  esac
done

# ── Defaults ─────────────────────────────────────────────────────────────────
CT_ID="${CT_ID:-203}"
CT_HOSTNAME="${CT_HOSTNAME:-dashboard-01}"
CT_STORAGE="${CT_STORAGE:-local-lvm}"
CT_DISK="${CT_DISK:-4}"
CT_MEMORY="${CT_MEMORY:-512}"
CT_SWAP="${CT_SWAP:-256}"
CT_CORES="${CT_CORES:-1}"
CT_TEMPLATE_STORAGE="${CT_TEMPLATE_STORAGE:-local}"
CT_TEMPLATE_DISTRO="${CT_TEMPLATE_DISTRO:-debian-13}"
NET_BRIDGE="${NET_BRIDGE:-vmbr0}"
NET_IP="${NET_IP:-10.0.0.21/24}"
NET_GW="${NET_GW:-10.0.0.1}"
NET_DNS="${NET_DNS:-1.1.1.1}"
CT_CP_ID="${CT_CP_ID:-202}"
CP_INSTALL_DIR="${CP_INSTALL_DIR:-/opt/ninja-ops}"
CP_SERVICE_USER="${CP_SERVICE_USER:-ninja}"
VITE_API_URL="${VITE_API_URL:-http://10.0.0.20:3000}"
DASH_DIR="${DASH_DIR:-/opt/dashboard}"
SERVE_PORT="${SERVE_PORT:-8080}"
SERVICE_USER="${SERVICE_USER:-ninja}"
NODE_VERSION="${NODE_VERSION:-22}"
TZ="${TZ:-Pacific/Auckland}"
OPT_USE_ENV="${OPT_USE_ENV:-0}"

# ── Interactive configuration ────────────────────────────────────────────────
if [ "${OPT_YES:-0}" -eq 0 ]; then
  if [ "${OPT_USE_ENV:-0}" -eq 0 ]; then
    printf '%s[ninja]%s Use pre-generated secrets from environment? [Y/n]: ' "$C_CYN" "$C_RST" >/dev/tty
    read -r _ue </dev/tty
    case "$_ue" in n|N|no|NO) OPT_USE_ENV=0 ;; *) OPT_USE_ENV=1 ;; esac
  fi
  printf '\n'

  printf '\n'
  log_info "Container  (press Enter to accept defaults)"
  printf '\n'
  prompt_default "VMID" "$CT_ID" "any unused Proxmox container ID"
  CT_ID="$REPLY"
  prompt_default "Hostname" "$CT_HOSTNAME"
  CT_HOSTNAME="$REPLY"
  prompt_default "Storage" "$CT_STORAGE" "local-lvm, local, zfspool"
  CT_STORAGE="$REPLY"
  prompt_default "Template" "$CT_TEMPLATE_DISTRO" "debian-12, debian-13, ubuntu-24.04"
  CT_TEMPLATE_DISTRO="$REPLY"
  prompt_default "Timezone" "$TZ" "UTC, Europe/London, America/New_York, Australia/Sydney"
  TZ="$REPLY"

  printf '\n'
  log_info "Network"
  printf '\n'
  prompt_default "IP/CIDR" "$NET_IP" "10.0.0.x/24 or dhcp"
  NET_IP="$REPLY"
  if [ "$NET_IP" != "dhcp" ]; then
    prompt_default "Gateway" "$NET_GW"
    NET_GW="$REPLY"
  fi
  prompt_default "DNS" "$NET_DNS" "1.1.1.1, 8.8.8.8"
  NET_DNS="$REPLY"
  prompt_default "Bridge" "$NET_BRIDGE" "vmbr0, vmbr1"
  NET_BRIDGE="$REPLY"

  printf '\n'
  log_info "Resources"
  printf '\n'
  prompt_default "Disk (GB)" "$CT_DISK" "minimum 2"
  CT_DISK="$REPLY"
  prompt_default "Memory (MB)" "$CT_MEMORY" "256, 512, 1024"
  CT_MEMORY="$REPLY"
  prompt_default "Swap (MB)" "$CT_SWAP"
  CT_SWAP="$REPLY"
  prompt_default "Cores" "$CT_CORES" "1, 2"
  CT_CORES="$REPLY"

  printf '\n'
  log_info "Dashboard"
  printf '\n'
  prompt_default "Control plane API URL" "$VITE_API_URL" "http://10.0.0.20:3000"
  VITE_API_URL="$REPLY"
  prompt_default "Serve port" "$SERVE_PORT" "8080, 3001"
  SERVE_PORT="$REPLY"
  prompt_default "Control plane CT ID (build source)" "$CT_CP_ID"
  CT_CP_ID="$REPLY"
  printf '\n'
fi

# ── Preflight ────────────────────────────────────────────────────────────────
check_proxmox_host

pct status "$CT_CP_ID" 2>/dev/null | grep -q running || \
  die "Control plane CT $CT_CP_ID is not running — run setup-control-plane.sh first"

exec_ct "$CT_CP_ID" "test -d ${CP_INSTALL_DIR}/apps/dashboard" || \
  die "Dashboard source not found in CT $CT_CP_ID at ${CP_INSTALL_DIR}/apps/dashboard"

if [ "${OPT_FORCE:-0}" -eq 1 ] && pct status "$CT_ID" >/dev/null 2>&1; then
  log_warn "Destroying existing CT $CT_ID (--force)"
  pct stop "$CT_ID" 2>/dev/null || true
  pct destroy "$CT_ID" --force
fi

# ── Confirm ──────────────────────────────────────────────────────────────────
confirm_settings "Dashboard LXC — CT $CT_ID" \
  "CT_ID=$CT_ID" \
  "CT_HOSTNAME=$CT_HOSTNAME" \
  "CT_STORAGE=$CT_STORAGE (${CT_DISK}GB)" \
  "CT_MEMORY=${CT_MEMORY}MB / ${CT_SWAP}MB swap / ${CT_CORES} core" \
  "NET_IP=$NET_IP (gw $NET_GW)" \
  "CT_CP_ID=$CT_CP_ID (build source)" \
  "VITE_API_URL=$VITE_API_URL" \
  "SERVE_PORT=$SERVE_PORT" \
  "TZ=$TZ"

# ── Build dashboard on control plane container ────────────────────────────────
log_info "Building dashboard on CT $CT_CP_ID (VITE_API_URL=$VITE_API_URL)..."
exec_ct "$CT_CP_ID" "cd ${CP_INSTALL_DIR} && \
  sudo -u ${CP_SERVICE_USER} pnpm --filter @ninja/types build && \
  VITE_API_URL='${VITE_API_URL}' sudo -u ${CP_SERVICE_USER} pnpm --filter @ninja/dashboard build"
log_ok "Dashboard built on CT $CT_CP_ID"

# ── Transfer dist/ to this container ─────────────────────────────────────────
log_info "Transferring dist/ from CT $CT_CP_ID to CT $CT_ID..."
exec_ct "$CT_CP_ID" "tar -czf /tmp/ninja-dashboard.tar.gz -C ${CP_INSTALL_DIR}/apps/dashboard dist"
pct pull "$CT_CP_ID" /tmp/ninja-dashboard.tar.gz /tmp/ninja-dashboard.tar.gz
exec_ct "$CT_CP_ID" "rm -f /tmp/ninja-dashboard.tar.gz"
log_ok "dist/ pulled from CT $CT_CP_ID"

# ── Find and download template ───────────────────────────────────────────────
log_info "Finding latest $CT_TEMPLATE_DISTRO template..."
TEMPLATE=$(find_latest_template "$CT_TEMPLATE_DISTRO")
[ -n "$TEMPLATE" ] || die "No template found matching '$CT_TEMPLATE_DISTRO'"
log_ok "Template: $TEMPLATE"

log_info "Ensuring template is downloaded..."
download_template "$CT_TEMPLATE_STORAGE" "$TEMPLATE"
log_ok "Template ready"

# ── Create container ─────────────────────────────────────────────────────────
log_info "Creating LXC container $CT_ID..."
create_lxc
log_ok "Container $CT_ID is running"

# ── Base packages ────────────────────────────────────────────────────────────
log_info "Installing base packages..."
install_base_packages "$CT_ID"
log_ok "Base packages installed"

log_info "Configuring locale and timezone..."
configure_locale_timezone "$CT_ID" "$TZ"
log_ok "Locale and timezone configured"

# ── Node.js ──────────────────────────────────────────────────────────────────
log_info "Installing Node.js ${NODE_VERSION}..."
exec_ct "$CT_ID" "curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
  apt-get install -y -qq nodejs"
log_ok "Node.js installed"

# ── serve ─────────────────────────────────────────────────────────────────────
log_info "Installing serve..."
exec_ct "$CT_ID" "npm install -g serve"
log_ok "serve installed"

# ── Service user ─────────────────────────────────────────────────────────────
log_info "Creating service user: $SERVICE_USER..."
exec_ct "$CT_ID" "id -u ${SERVICE_USER} >/dev/null 2>&1 || useradd -m -r -s /bin/bash ${SERVICE_USER}"
log_ok "Service user ready"

# ── Deploy dist/ ──────────────────────────────────────────────────────────────
log_info "Deploying dist/ to CT $CT_ID..."
pct push "$CT_ID" /tmp/ninja-dashboard.tar.gz /tmp/ninja-dashboard.tar.gz
rm -f /tmp/ninja-dashboard.tar.gz
exec_ct "$CT_ID" "mkdir -p ${DASH_DIR} && \
  tar -xzf /tmp/ninja-dashboard.tar.gz -C ${DASH_DIR} && \
  chown -R ${SERVICE_USER}:${SERVICE_USER} ${DASH_DIR} && \
  rm /tmp/ninja-dashboard.tar.gz"
log_ok "dist/ deployed to ${DASH_DIR}/dist"

# ── Install systemd service ─────────────────────────────────────────────────
log_info "Installing systemd service..."
exec_ct "$CT_ID" "cat > /etc/systemd/system/ninja-dashboard.service <<'UNITEOF'
[Unit]
Description=ninja-ops Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${DASH_DIR}
ExecStart=/usr/local/bin/serve dist --single --listen 0.0.0.0:${SERVE_PORT}
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNITEOF"

exec_ct "$CT_ID" "systemctl daemon-reload && systemctl enable --now ninja-dashboard"
log_ok "Service installed and started"

# ── Verify ───────────────────────────────────────────────────────────────────
NET_IP_BARE=$(strip_cidr "$NET_IP")

log_info "Verifying dashboard..."
_dash_ok=0
for _i in $(seq 1 15); do
  if exec_ct "$CT_ID" "curl -sf http://localhost:${SERVE_PORT}" >/dev/null 2>&1; then
    _dash_ok=1
    break
  fi
  sleep 2
done

if [ "$_dash_ok" -eq 1 ]; then
  log_ok "Dashboard is responding"
else
  log_warn "Dashboard did not respond after 30s — check: pct exec $CT_ID -- journalctl -u ninja-dashboard -n 50"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n'
print_box_top
print_box_title "Dashboard Ready"
print_box_mid
print_box_blank
print_box_kv "Container" "CT $CT_ID ($CT_HOSTNAME)"
print_box_kv "Dashboard URL" "http://${NET_IP_BARE}:${SERVE_PORT}"
print_box_kv "API URL (baked in)" "$VITE_API_URL"
print_box_blank
print_box_bot
printf '\n'

log_ok "Done. Dashboard is available at http://${NET_IP_BARE}:${SERVE_PORT}"
log_info "To redeploy after a code change, rerun this script — the control plane will not restart."
