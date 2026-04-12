#!/bin/bash
# setup-control-plane.sh — Provision the ninja-ops control plane in an LXC container
# Self-contained: can be curl-piped or run from the scripts/ directory.
#
# Usage:
#   DATABASE_URL="postgres://ninja:pw@10.0.0.10:5432/ninja_ops" \
#   REDIS_URL="redis://10.0.0.11:6379" \
#   bash setup-control-plane.sh [--yes] [--force] [--help]
#
# DATABASE_URL and REDIS_URL are required. All other variables have defaults.

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
      pct exec "$CT_ID" -- ping -c1 -W1 8.8.8.8 >/dev/null 2>&1 && break
      printf '.'; sleep 2; i=$((i + 1))
    done; printf '\n'
    [ "$i" -lt 30 ] || die "CT $CT_ID did not get network after 60s — check bridge/gateway config"
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
Usage: setup-control-plane.sh [OPTIONS]

Provision the ninja-ops control plane in an LXC container on Proxmox VE.

Options:
  --yes, -y    Skip confirmation prompt
  --force      Recreate container if it already exists
  --help, -h   Show this help message

Required environment variables:
  DATABASE_URL          PostgreSQL connection string (postgres://...)
  REDIS_URL             Redis connection string (redis://...)

Optional environment variables:
  CT_ID                 Container ID (default: 202)
  CT_HOSTNAME           Hostname (default: control-plane-01)
  CT_STORAGE            Storage pool (default: local-lvm)
  CT_DISK               Disk size in GB (default: 8)
  CT_MEMORY             Memory in MB (default: 2048)
  CT_SWAP               Swap in MB (default: 512)
  CT_CORES              CPU cores (default: 2)
  NET_IP                IP with CIDR (default: 10.0.0.20/24)
  NET_GW                Gateway (default: 10.0.0.1)
  NODE_VERSION          Node.js version (default: 22)
  REPO_URL              Git repo URL (default: https://github.com/NinjaGoldfinch/ninja-ops.git)
  REPO_BRANCH           Branch to clone (default: main)
  GITHUB_TOKEN          Token for private repo (default: empty)
  INSTALL_DIR           Install directory (default: /opt/ninja-ops)
  SERVICE_USER          System user (default: ninja)
  JWT_SECRET            Auto-generated if empty
  ENCRYPTION_KEY        Auto-generated if empty (64 hex chars)
  AGENT_SECRET          Auto-generated if empty
  GITHUB_WEBHOOK_SECRET Auto-generated if empty
  ADMIN_USERNAME        Seed admin username (default: admin)
  ADMIN_PASSWORD        Seed admin password (default: auto-generated)
  CP_PORT               API port (default: 3000)
  CORS_ORIGIN           CORS origin (default: http://<dashboard IP>)
  RUN_SEED              Run database seed (default: true)
  TZ                    Timezone (default: Pacific/Auckland)
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
CT_ID="${CP_CT_ID:-102}"
CT_HOSTNAME="${CP_HOSTNAME:-control-plane-01}"
CT_STORAGE="${CP_STORAGE:-local-lvm}"
CT_DISK="${CP_DISK:-8}"
CT_MEMORY="${CP_MEMORY:-2048}"
CT_SWAP="${CP_SWAP:-512}"
CT_CORES="${CP_CORES:-2}"
CT_TEMPLATE_STORAGE="${CT_TEMPLATE_STORAGE:-local}"
CT_TEMPLATE_DISTRO="${CP_TEMPLATE:-debian-13.4-slim}"
NET_BRIDGE="${CP_NET_BRIDGE:-vmbr0}"
NET_IP="${CP_NET_IP:-10.0.0.20/24}"
NET_GW="${CP_NET_GW:-10.0.0.1}"
NET_DNS="${CP_NET_DNS:-1.1.1.1}"
NODE_VERSION="${NODE_VERSION:-22}"
REPO_URL="${REPO_URL:-https://github.com/NinjaGoldfinch/ninja-ops.git}"
REPO_BRANCH="${CP_REPO_BRANCH:-${REPO_BRANCH:-main}}"
GITHUB_TOKEN="${CP_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
INSTALL_DIR="${INSTALL_DIR:-/opt/ninja-ops}"
SERVICE_USER="${SERVICE_USER:-ninja}"
TZ="${CP_TZ:-${TZ:-Pacific/Auckland}}"
RUN_SEED="${RUN_SEED:-true}"
CP_PORT="${CP_PORT:-3000}"
DATABASE_URL="${DATABASE_URL:-}"
REDIS_URL="${REDIS_URL:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(gen_secret 12)}"

[ -z "$DATABASE_URL" ] && die "DATABASE_URL is required (e.g. postgres://ninja:pw@10.0.0.10:5432/ninja_ops)"
[ -z "$REDIS_URL" ]    && die "REDIS_URL is required (e.g. redis://10.0.0.11:6379)"

case "$DATABASE_URL" in
  postgres://*) ;;
  *) die "DATABASE_URL must start with postgres://" ;;
esac
case "$REDIS_URL" in
  redis://*) ;;
  *) die "REDIS_URL must start with redis://" ;;
esac

# Auto-generate secrets if not provided
JWT_SECRET="${JWT_SECRET:-$(gen_secret 64)}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(gen_secret 32)}"
AGENT_SECRET="${AGENT_SECRET:-$(gen_secret 64)}"
GITHUB_WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-$(gen_secret 32)}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(gen_secret 12)}"
CORS_ORIGIN="${CORS_ORIGIN:-http://10.0.0.21}"

# ── Preflight ────────────────────────────────────────────────────────────────
check_proxmox_host

if [ "${OPT_FORCE:-0}" -eq 1 ] && pct status "$CT_ID" >/dev/null 2>&1; then
  log_warn "Destroying existing CT $CT_ID (--force)"
  pct stop "$CT_ID" 2>/dev/null || true
  pct destroy "$CT_ID" --force
fi

# ── Confirm ──────────────────────────────────────────────────────────────────
confirm_settings "Control Plane LXC — CT $CT_ID" \
  "CT_ID=$CT_ID" \
  "CT_HOSTNAME=$CT_HOSTNAME" \
  "CT_STORAGE=$CT_STORAGE (${CT_DISK}GB)" \
  "CT_MEMORY=${CT_MEMORY}MB / ${CT_SWAP}MB swap / ${CT_CORES} cores" \
  "NET_IP=$NET_IP (gw $NET_GW)" \
  "DATABASE_URL=${DATABASE_URL:0:30}..." \
  "REDIS_URL=$REDIS_URL" \
  "JWT_SECRET=${JWT_SECRET:0:8}..." \
  "ENCRYPTION_KEY=${ENCRYPTION_KEY:0:8}..." \
  "AGENT_SECRET=${AGENT_SECRET:0:8}..." \
  "ADMIN_USERNAME=$ADMIN_USERNAME" \
  "ADMIN_PASSWORD=${ADMIN_PASSWORD:0:8}..." \
  "CP_PORT=$CP_PORT" \
  "CORS_ORIGIN=$CORS_ORIGIN" \
  "REPO_BRANCH=$REPO_BRANCH" \
  "RUN_SEED=$RUN_SEED" \
  "TZ=$TZ"

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

# ── Build dependencies ───────────────────────────────────────────────────────
log_info "Installing build dependencies..."
exec_ct "$CT_ID" "apt-get install -y -qq build-essential python3"
log_ok "Build dependencies installed"

# ── Node.js ──────────────────────────────────────────────────────────────────
log_info "Installing Node.js ${NODE_VERSION}..."
exec_ct "$CT_ID" "curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - && \
  apt-get install -y -qq nodejs"
log_ok "Node.js $(exec_ct "$CT_ID" "node --version") installed"

# ── pnpm ─────────────────────────────────────────────────────────────────────
log_info "Installing pnpm..."
exec_ct "$CT_ID" "npm install -g pnpm"
log_ok "pnpm installed"

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

# ── Install deps and build ───────────────────────────────────────────────────
log_info "Installing dependencies (this may take a few minutes)..."
exec_ct "$CT_ID" "cd ${INSTALL_DIR} && sudo -u ${SERVICE_USER} pnpm install --frozen-lockfile"
log_ok "Dependencies installed"

log_info "Building packages..."
exec_ct "$CT_ID" "cd ${INSTALL_DIR} && \
  sudo -u ${SERVICE_USER} pnpm --filter @ninja/types build && \
  sudo -u ${SERVICE_USER} pnpm --filter @ninja/control-plane build"
log_ok "Control plane built"

log_info "Packaging agent bundles..."
exec_ct "$CT_ID" "cd ${INSTALL_DIR} && \
  sudo -u ${SERVICE_USER} pnpm package:agent && \
  sudo -u ${SERVICE_USER} pnpm package:log-agent"
log_ok "Agent bundles packaged"

# ── Write environment file ───────────────────────────────────────────────────
log_info "Writing environment file..."
exec_ct "$CT_ID" "mkdir -p /etc/ninja-ops && chown ${SERVICE_USER}:${SERVICE_USER} /etc/ninja-ops"

exec_ct "$CT_ID" "cat > /etc/ninja-ops/control-plane.env <<'ENVEOF'
# Generated by setup-control-plane.sh on $(date -u '+%Y-%m-%dT%H:%M:%SZ')
# DO NOT EDIT MANUALLY — rerun the setup script to regenerate

# Server
PORT=${CP_PORT}
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

# Database
DATABASE_URL=${DATABASE_URL}

# Redis
REDIS_URL=${REDIS_URL}

# Auth
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRY=24h
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Agent
AGENT_SECRET=${AGENT_SECRET}
AGENT_JWT_EXPIRY=7d
AGENT_BUNDLE_PATH=${INSTALL_DIR}/apps/control-plane/agent-bundle.tar.gz
LOG_AGENT_BUNDLE_PATH=${INSTALL_DIR}/apps/control-plane/log-agent-bundle.tar.gz

# GitHub Webhooks
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}

# CORS
CORS_ORIGIN=${CORS_ORIGIN}

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000
ENVEOF"

exec_ct "$CT_ID" "chmod 0600 /etc/ninja-ops/control-plane.env && \
  chown ${SERVICE_USER}:${SERVICE_USER} /etc/ninja-ops/control-plane.env"
log_ok "Environment file written to /etc/ninja-ops/control-plane.env"

# ── Run migrations ───────────────────────────────────────────────────────────
log_info "Running database migrations..."
exec_ct "$CT_ID" "cd ${INSTALL_DIR} && \
  DATABASE_URL='${DATABASE_URL}' \
  sudo -E -u ${SERVICE_USER} pnpm --filter @ninja/control-plane db:migrate"
log_ok "Migrations complete"

# ── Seed database ────────────────────────────────────────────────────────────
if [ "$RUN_SEED" = "true" ]; then
  log_info "Seeding database..."
  exec_ct "$CT_ID" "cd ${INSTALL_DIR} && \
    DATABASE_URL='${DATABASE_URL}' \
    ADMIN_USERNAME='${ADMIN_USERNAME}' \
    ADMIN_PASSWORD='${ADMIN_PASSWORD}' \
    sudo -E -u ${SERVICE_USER} pnpm --filter @ninja/control-plane db:seed"
  log_ok "Database seeded"
else
  log_info "Skipping database seed (RUN_SEED=$RUN_SEED)"
fi

# ── Install systemd service ─────────────────────────────────────────────────
log_info "Installing systemd service..."
exec_ct "$CT_ID" "cat > /etc/systemd/system/ninja-control-plane.service <<'UNITEOF'
[Unit]
Description=ninja-ops Control Plane
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}/apps/control-plane
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/etc/ninja-ops/control-plane.env
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNITEOF"

exec_ct "$CT_ID" "systemctl daemon-reload && systemctl enable --now ninja-control-plane"
log_ok "Service installed and started"

# ── Health check ─────────────────────────────────────────────────────────────
NET_IP_BARE=$(strip_cidr "$NET_IP")

log_info "Waiting for control plane to start..."
_health_ok=0
for _i in $(seq 1 30); do
  if exec_ct "$CT_ID" "curl -sf http://localhost:${CP_PORT}/healthz" >/dev/null 2>&1; then
    _health_ok=1
    break
  fi
  sleep 2
done

if [ "$_health_ok" -eq 1 ]; then
  log_ok "Control plane is healthy"
else
  log_warn "Health check did not pass after 60s — check: pct exec $CT_ID -- journalctl -u ninja-control-plane -n 50"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
printf '\n'
print_box_top
print_box_title "Control Plane Ready"
print_box_mid
print_box_blank
print_box_kv "Container" "CT $CT_ID ($CT_HOSTNAME)"
print_box_kv "API" "http://${NET_IP_BARE}:${CP_PORT}"
print_box_kv "Health" "http://${NET_IP_BARE}:${CP_PORT}/healthz"
print_box_blank
print_box_title "Admin Credentials"
print_box_blank
print_box_kv "Username" "$ADMIN_USERNAME"
print_box_kv "Password" "$ADMIN_PASSWORD"
print_box_blank
print_box_title "Secrets (save these)"
print_box_blank
print_box_kv "JWT_SECRET" "$JWT_SECRET"
print_box_kv "ENCRYPTION_KEY" "$ENCRYPTION_KEY"
print_box_kv "AGENT_SECRET" "$AGENT_SECRET"
print_box_kv "GITHUB_WEBHOOK_SECRET" "$GITHUB_WEBHOOK_SECRET"
print_box_blank
print_box_bot
printf '\n'

log_ok "Done. The control plane is running at http://${NET_IP_BARE}:${CP_PORT}"
log_warn "Save the credentials and secrets above — they cannot be recovered."
