#!/bin/bash
# setup-dashboard.sh — Provision the ninja-ops dashboard in an LXC container
# Self-contained: can be curl-piped or run from the scripts/ directory.
#
# Usage:
#   bash setup-dashboard.sh [--yes] [--force] [--help]
#   CONTROL_PLANE_INTERNAL=10.0.0.20:3000 bash setup-dashboard.sh --yes

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
  gen_secret() { openssl rand -hex "$1"; }
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
      pct create "$CT_ID" "${CT_TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
        --hostname "$CT_HOSTNAME" --storage "$CT_STORAGE" \
        --rootfs "${CT_STORAGE}:${CT_DISK}" --memory "$CT_MEMORY" \
        --swap "$CT_SWAP" --cores "$CT_CORES" \
        --net0 "name=eth0,bridge=${NET_BRIDGE},ip=${NET_IP},gw=${NET_GW}" \
        --nameserver "$NET_DNS" --unprivileged 1 --features nesting=1 --start 1
    fi
    pct status "$CT_ID" | grep -q running || pct start "$CT_ID"
    local i=0
    while [ "$i" -lt 30 ]; do
      pct exec "$CT_ID" -- ping -c1 -W1 8.8.8.8 >/dev/null 2>&1 && break
      sleep 2; i=$((i + 1))
    done
    [ "$i" -lt 30 ] || die "CT $CT_ID did not get network after 60s"
  }
  exec_ct() { pct exec "$1" -- bash -c "$2"; }
  install_base_packages() {
    exec_ct "$1" "apt-get update -qq && apt-get upgrade -y -qq && \
      apt-get install -y -qq curl wget gnupg ca-certificates sudo htop lsb-release git"
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
  print_box_title() { local _t="$1" _tlen=${#1} _pad_l=$(( (_BOX_INNER - ${#1}) / 2 )) _pad_r=$(( _BOX_INNER - ${#1} - (_BOX_INNER - ${#1}) / 2 )); printf '║'; _print_n_chars ' ' "$_pad_l"; printf '%s' "$_t"; _print_n_chars ' ' "$_pad_r"; printf '║\n'; }
  print_box_blank() { printf '║\n'; }
  print_box_kv() { printf '║  %s =\n║    %s\n' "$1" "$2"; }
  confirm_settings() {
    local _title="$1"; shift; printf '\n'; print_box_top; print_box_title "$_title"; print_box_mid; print_box_blank
    for _kv in "$@"; do print_box_kv "${_kv%%=*}" "${_kv#*=}"; done
    print_box_blank; print_box_bot; printf '\n'
    if [ "${OPT_YES:-0}" -eq 1 ]; then log_info "Proceeding (--yes)"; return 0; fi
    printf '%sProceed? [y/N]:%s ' "$C_YLW" "$C_RST"; read -r _c
    case "$_c" in y|Y|yes|YES) return 0 ;; *) die "Aborted." ;; esac
  }
fi

# ── Help ─────────────────────────────────────────────────────────────────────
show_help() {
  cat <<'EOF'
Usage: setup-dashboard.sh [OPTIONS]

Provision the ninja-ops dashboard (React + Caddy) in an LXC container on Proxmox VE.

Options:
  --yes, -y    Skip confirmation prompt
  --force      Recreate container if it already exists
  --help, -h   Show this help message

Environment variables (all optional):
  CT_ID                   Container ID (default: 203)
  CT_HOSTNAME             Hostname (default: dashboard-01)
  CT_STORAGE              Storage pool (default: local-lvm)
  CT_DISK                 Disk size in GB (default: 4)
  CT_MEMORY               Memory in MB (default: 1024)
  CT_SWAP                 Swap in MB (default: 256)
  CT_CORES                CPU cores (default: 1)
  NET_IP                  IP with CIDR (default: 10.0.0.21/24)
  NET_GW                  Gateway (default: 10.0.0.1)
  CONTROL_PLANE_INTERNAL  Control plane address (default: 10.0.0.20:3000)
  CADDY_PORT              Port Caddy listens on (default: 80)
  NODE_VERSION            Node.js version (default: 22)
  REPO_URL                Git repo URL
  REPO_BRANCH             Branch to clone (default: main)
  GITHUB_TOKEN            Token for private repo (default: empty)
  INSTALL_DIR             Install directory (default: /opt/ninja-ops)
  SERVICE_USER            System user (default: ninja)
  TZ                      Timezone (default: Pacific/Auckland)
EOF
}

# ── Parse flags ──────────────────────────────────────────────────────────────
for _arg in "$@"; do
  case "$_arg" in
    --yes|-y)   OPT_YES=1 ;;
    --force)    OPT_FORCE=1 ;;
    --help|-h)  show_help; exit 0 ;;
    *) die "Unknown option: $_arg (use --help)" ;;
  esac
done

# ── Defaults ─────────────────────────────────────────────────────────────────
CT_ID="${CT_ID:-203}"
CT_HOSTNAME="${CT_HOSTNAME:-dashboard-01}"
CT_STORAGE="${CT_STORAGE:-local-lvm}"
CT_DISK="${CT_DISK:-4}"
CT_MEMORY="${CT_MEMORY:-1024}"
CT_SWAP="${CT_SWAP:-256}"
CT_CORES="${CT_CORES:-1}"
CT_TEMPLATE_STORAGE="${CT_TEMPLATE_STORAGE:-local}"
CT_TEMPLATE_DISTRO="${CT_TEMPLATE_DISTRO:-debian-12}"
NET_BRIDGE="${NET_BRIDGE:-vmbr0}"
NET_IP="${NET_IP:-10.0.0.21/24}"
NET_GW="${NET_GW:-10.0.0.1}"
NET_DNS="${NET_DNS:-1.1.1.1}"
CONTROL_PLANE_INTERNAL="${CONTROL_PLANE_INTERNAL:-10.0.0.20:3000}"
CADDY_PORT="${CADDY_PORT:-80}"
NODE_VERSION="${NODE_VERSION:-22}"
REPO_URL="${REPO_URL:-https://github.com/NinjaGoldfinch/ninja-ops.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ninja-ops}"
SERVICE_USER="${SERVICE_USER:-ninja}"
TZ="${TZ:-Pacific/Auckland}"

# ── Preflight ────────────────────────────────────────────────────────────────
check_proxmox_host

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
  "CONTROL_PLANE_INTERNAL=$CONTROL_PLANE_INTERNAL" \
  "CADDY_PORT=$CADDY_PORT" \
  "REPO_BRANCH=$REPO_BRANCH" \
  "TZ=$TZ"

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

log_info "Installing pnpm..."
exec_ct "$CT_ID" "npm install -g pnpm"
log_ok "pnpm installed"

# ── Caddy ────────────────────────────────────────────────────────────────────
log_info "Installing Caddy..."
exec_ct "$CT_ID" "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
  gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
  tee /etc/apt/sources.list.d/caddy-stable.list && \
  apt-get update -qq && apt-get install -y -qq caddy"
log_ok "Caddy installed"

# ── Service user ─────────────────────────────────────────────────────────────
log_info "Creating service user: $SERVICE_USER..."
exec_ct "$CT_ID" "id -u ${SERVICE_USER} >/dev/null 2>&1 || useradd -m -r -s /bin/bash ${SERVICE_USER}"
log_ok "Service user ready"

# ── Clone repository ─────────────────────────────────────────────────────────
log_info "Cloning repository (branch: $REPO_BRANCH)..."
CLONE_URL="$REPO_URL"
if [ -n "$GITHUB_TOKEN" ]; then
  CLONE_URL="${REPO_URL/https:\/\//https://${GITHUB_TOKEN}@}"
fi
exec_ct "$CT_ID" "git clone --branch ${REPO_BRANCH} ${CLONE_URL} ${INSTALL_DIR} && \
  chown -R ${SERVICE_USER}:${SERVICE_USER} ${INSTALL_DIR}"
log_ok "Repository cloned to $INSTALL_DIR"

# ── Install deps and build dashboard ─────────────────────────────────────────
log_info "Installing dependencies..."
exec_ct "$CT_ID" "cd ${INSTALL_DIR} && sudo -u ${SERVICE_USER} pnpm install --frozen-lockfile"
log_ok "Dependencies installed"

log_info "Building dashboard..."
exec_ct "$CT_ID" "cd ${INSTALL_DIR} && \
  sudo -u ${SERVICE_USER} pnpm --filter @ninja/types build && \
  VITE_API_URL='' sudo -u ${SERVICE_USER} pnpm --filter @ninja/dashboard build"
log_ok "Dashboard built"

# ── Configure Caddy ──────────────────────────────────────────────────────────
# Proxy paths match vite.config.ts: /api and /ws
log_info "Writing Caddyfile..."
exec_ct "$CT_ID" "cat > /etc/caddy/Caddyfile <<'CADDYEOF'
:${CADDY_PORT} {
    root * ${INSTALL_DIR}/apps/dashboard/dist
    file_server
    try_files {path} /index.html

    handle /api/* {
        reverse_proxy ${CONTROL_PLANE_INTERNAL}
    }

    handle /ws* {
        reverse_proxy ${CONTROL_PLANE_INTERNAL}
    }

    header {
        X-Content-Type-Options \"nosniff\"
        X-Frame-Options \"DENY\"
    }

    @static path *.js *.css *.png *.svg *.ico *.woff *.woff2
    header @static Cache-Control \"public, max-age=31536000, immutable\"
}
CADDYEOF"
log_ok "Caddyfile written"

log_info "Validating Caddy configuration..."
exec_ct "$CT_ID" "caddy validate --config /etc/caddy/Caddyfile"
log_ok "Caddy configuration valid"

log_info "Starting Caddy..."
exec_ct "$CT_ID" "systemctl restart caddy && systemctl enable caddy"
log_ok "Caddy is running and enabled"

# ── Verify ───────────────────────────────────────────────────────────────────
NET_IP_BARE=$(strip_cidr "$NET_IP")

log_info "Verifying dashboard..."
_dash_ok=0
for _i in $(seq 1 15); do
  if exec_ct "$CT_ID" "curl -sf http://localhost:${CADDY_PORT}" >/dev/null 2>&1; then
    _dash_ok=1
    break
  fi
  sleep 2
done

if [ "$_dash_ok" -eq 1 ]; then
  log_ok "Dashboard is responding"
else
  log_warn "Dashboard did not respond after 30s — check: pct exec $CT_ID -- journalctl -u caddy -n 50"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n'
print_box_top
print_box_title "Dashboard Ready"
print_box_mid
print_box_blank
print_box_kv "Container" "CT $CT_ID ($CT_HOSTNAME)"
print_box_kv "Dashboard URL" "http://${NET_IP_BARE}:${CADDY_PORT}"
print_box_kv "API proxy" "/api/* → ${CONTROL_PLANE_INTERNAL}"
print_box_kv "WS proxy" "/ws* → ${CONTROL_PLANE_INTERNAL}"
print_box_blank
print_box_bot
printf '\n'

log_ok "Done. Dashboard is available at http://${NET_IP_BARE}:${CADDY_PORT}"
