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
  list_downloaded_templates() { pveam list "$1" 2>/dev/null | awk 'NR>1 {n=$1; sub(/.*vztmpl\//,"",n); print n}' || true; }
  list_available_templates() { { pveam available --section oci 2>/dev/null; pveam available --section system 2>/dev/null; } | awk '{print $2}' | sort -u || true; }
  prepare_template() {
    local _p="${1:-}" _s="${2:-local}" _d _c _def _i _t _sel _avail
    log_info "Listing downloaded templates in '$_s'..."
    _d=$(list_downloaded_templates "$_s"); _c=$(printf '%s\n' "$_d" | grep -c . || true)
    if [ -n "$_d" ] && [ "$_c" -gt 0 ]; then
      if [ "${OPT_YES:-0}" -eq 1 ]; then
        TEMPLATE=$(printf '%s\n' "$_d" | grep "${_p}" | sort -V | tail -1 || true)
        if [ -z "$TEMPLATE" ]; then TEMPLATE=$(printf '%s\n' "$_d" | head -1); log_warn "No match for '${_p}', using: $TEMPLATE"
        else log_ok "Auto-selected: $TEMPLATE"; fi; return
      fi
      printf '\n%sDownloaded templates in %s:%s\n' "$C_BLD" "$_s" "$C_RST"; _def=1; _i=1
      while IFS= read -r _t; do
        if [ -n "$_p" ] && printf '%s' "$_t" | grep -q "$_p"; then
          printf '  [%d] %s %s(suggested)%s\n' "$_i" "$_t" "$C_GRN" "$C_RST"; _def=$_i
        else printf '  [%d] %s\n' "$_i" "$_t"; fi
        _i=$((_i+1))
      done <<< "$_d"; printf '\n'
      prompt_default "Select template number" "$_def"; _sel="$REPLY"
      TEMPLATE=$(printf '%s\n' "$_d" | sed -n "${_sel}p"); [ -n "$TEMPLATE" ] || die "Invalid selection: $_sel"
      log_ok "Selected: $TEMPLATE"
    else
      log_warn "No templates downloaded to '$_s' — fetching available list..."
      pveam update >/dev/null 2>&1 || true
      _avail=$(list_available_templates); [ -n "$_avail" ] || die "No templates available and none downloaded"
      if [ "${OPT_YES:-0}" -eq 1 ]; then
        TEMPLATE=$(printf '%s\n' "$_avail" | grep "${_p}" | sort -V | tail -1 || true)
        [ -n "$TEMPLATE" ] || die "No available template matching '${_p}'"
        log_info "Downloading $TEMPLATE..."; pveam download "$_s" "$TEMPLATE"; log_ok "Downloaded: $TEMPLATE"; return
      fi
      printf '\n%sAvailable templates (not yet downloaded):%s\n' "$C_BLD" "$C_RST"; _def=1; _i=1
      while IFS= read -r _t; do
        if [ -n "$_p" ] && printf '%s' "$_t" | grep -q "$_p"; then
          printf '  [%d] %s %s(suggested)%s\n' "$_i" "$_t" "$C_GRN" "$C_RST"; _def=$_i
        else printf '  [%d] %s\n' "$_i" "$_t"; fi
        _i=$((_i+1))
      done <<< "$_avail"; printf '\n'
      prompt_default "Select template to download" "$_def"; _sel="$REPLY"
      TEMPLATE=$(printf '%s\n' "$_avail" | sed -n "${_sel}p"); [ -n "$TEMPLATE" ] || die "Invalid selection: $_sel"
      log_info "Downloading $TEMPLATE..."; pveam download "$_s" "$TEMPLATE"; log_ok "Downloaded: $TEMPLATE"
    fi
  }
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
    log_info "Waiting for CT $CT_ID to get network..."
    local i=0
    while [ "$i" -lt 30 ]; do
      pct exec "$CT_ID" -- sh -c 'awk "NR>1 && \$3!=\"00000000\"" /proc/net/route | grep -q .' >/dev/null 2>&1 && break
      printf '.'; sleep 2; i=$((i + 1))
    done; printf '\n'
    [ "$i" -lt 30 ] || die "CT $CT_ID did not get a default route after 60s — check bridge/gateway config"
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
      apt-get install -y -qq curl wget gnupg ca-certificates sudo htop lsb-release iproute2 iputils-ping"
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
    read -r REPLY </dev/tty; REPLY="${REPLY:-$2}"
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
  CT_TEMPLATE_DISTRO   Distro pattern (default: 13.4-slim)
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
    --help|-h)   show_help; exit 0 ;;
    *) die "Unknown option: $_arg (use --help)" ;;
  esac
done

# ── Defaults ─────────────────────────────────────────────────────────────────
CT_ID="${DASH_CT_ID:-103}"
CT_HOSTNAME="${DASH_HOSTNAME:-dashboard-01}"
CT_STORAGE="${DASH_STORAGE:-local-lvm}"
CT_DISK="${DASH_DISK:-4}"
CT_MEMORY="${DASH_MEMORY:-512}"
CT_SWAP="${DASH_SWAP:-256}"
CT_CORES="${DASH_CORES:-1}"
CT_TEMPLATE_STORAGE="${CT_TEMPLATE_STORAGE:-local}"
CT_TEMPLATE_DISTRO="${DASH_TEMPLATE:-13.4-slim}"
NET_BRIDGE="${DASH_NET_BRIDGE:-vmbr0}"
NET_IP="${DASH_NET_IP:-10.0.0.21/24}"
NET_GW="${DASH_NET_GW:-10.0.0.1}"
NET_DNS="${DASH_NET_DNS:-1.1.1.1}"
CT_CP_ID="${CP_CT_ID:-${CT_CP_ID:-102}}"
CP_INSTALL_DIR="${CP_INSTALL_DIR:-/opt/ninja-ops}"
CP_SERVICE_USER="${CP_SERVICE_USER:-ninja}"
VITE_API_URL="${DASH_VITE_API_URL:-${VITE_API_URL:-http://10.0.0.20:3000}}"
DASH_DIR="${DASH_DIR:-/opt/dashboard}"
SERVE_PORT="${DASH_SERVE_PORT:-${SERVE_PORT:-8080}}"
SERVICE_USER="${SERVICE_USER:-ninja}"
NODE_VERSION="${NODE_VERSION:-22}"
TZ="${DASH_TZ:-${TZ:-Pacific/Auckland}}"

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
prepare_template "$CT_TEMPLATE_DISTRO" "$CT_TEMPLATE_STORAGE"

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
