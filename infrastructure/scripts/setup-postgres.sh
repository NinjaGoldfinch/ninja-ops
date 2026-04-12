#!/bin/bash
# setup-postgres.sh — Provision a PostgreSQL LXC container on Proxmox VE
# Self-contained: can be curl-piped or run from the scripts/ directory.
#
# Usage:
#   bash setup-postgres.sh [--yes] [--force] [--help]
#   curl -sSL <url>/setup-postgres.sh | bash
#   PG_PASSWORD=mysecret CT_ID=200 bash setup-postgres.sh --yes
#
# All variables can be overridden via environment.

set -euo pipefail

# ── Source common.sh if available, otherwise define inline fallbacks ─────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo ".")"
[ -f "$SCRIPT_DIR/common.sh" ] && . "$SCRIPT_DIR/common.sh"

if [ "${_NINJA_COMMON_LOADED:-}" != "1" ]; then
  # Inline fallbacks for curl-pipe usage
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
Usage: setup-postgres.sh [OPTIONS]

Provision a PostgreSQL LXC container on Proxmox VE.

Options:
  --yes, -y    Skip confirmation prompt
  --force      Recreate container if it already exists
  --help, -h   Show this help message

Environment variables (all optional, sensible defaults provided):
  CT_ID                 Container ID (default: 200)
  CT_HOSTNAME           Hostname (default: postgres-01)
  CT_STORAGE            Storage pool (default: local-lvm)
  CT_DISK               Disk size in GB (default: 8)
  CT_MEMORY             Memory in MB (default: 1024)
  CT_SWAP               Swap in MB (default: 512)
  CT_CORES              CPU cores (default: 2)
  CT_TEMPLATE_STORAGE   Template storage (default: local)
  CT_TEMPLATE_DISTRO    Distro pattern (default: 13.4-slim)
  NET_BRIDGE            Network bridge (default: vmbr0)
  NET_IP                IP with CIDR (default: 10.0.0.10/24)
  NET_GW                Gateway (default: 10.0.0.1)
  NET_DNS               DNS server (default: 1.1.1.1)
  PG_VERSION            PostgreSQL version (default: 18)
  PG_DB                 Database name (default: ninja_ops)
  PG_USER               Database user (default: ninja)
  PG_PASSWORD           Password (default: auto-generated)
  PG_ALLOWED_NETWORK    Network for pg_hba.conf (default: 10.0.0.0/24)
  PG_MAX_CONNECTIONS    max_connections (default: 100)
  PG_SHARED_BUFFERS     shared_buffers (default: 256MB)
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
CT_ID="${PG_CT_ID:-100}"
CT_HOSTNAME="${PG_HOSTNAME:-postgres-01}"
CT_STORAGE="${PG_STORAGE:-local-lvm}"
CT_DISK="${PG_DISK:-8}"
CT_MEMORY="${PG_MEMORY:-1024}"
CT_SWAP="${PG_SWAP:-512}"
CT_CORES="${PG_CORES:-2}"
CT_TEMPLATE_STORAGE="${CT_TEMPLATE_STORAGE:-local}"
CT_TEMPLATE_DISTRO="${PG_TEMPLATE:-13.4-slim}"
NET_BRIDGE="${PG_NET_BRIDGE:-vmbr0}"
NET_IP="${PG_NET_IP:-10.0.0.10/24}"
NET_GW="${PG_NET_GW:-10.0.0.1}"
NET_DNS="${PG_NET_DNS:-1.1.1.1}"
PG_VERSION="${PG_VERSION:-18}"
PG_DB="${PG_DB:-ninja_ops}"
PG_USER="${PG_USER:-ninja}"
PG_PASSWORD="${PG_PASSWORD:-$(gen_secret 16)}"
PG_ALLOWED_NETWORK="${PG_ALLOWED_NETWORK:-10.0.0.0/24}"
PG_MAX_CONNECTIONS="${PG_MAX_CONNECTIONS:-100}"
PG_SHARED_BUFFERS="${PG_SHARED_BUFFERS:-256MB}"
TZ="${PG_TZ:-${TZ:-Pacific/Auckland}}"

# ── Preflight ────────────────────────────────────────────────────────────────
check_proxmox_host

if [ "${OPT_FORCE:-0}" -eq 1 ] && pct status "$CT_ID" >/dev/null 2>&1; then
  log_warn "Destroying existing CT $CT_ID (--force)"
  pct stop "$CT_ID" 2>/dev/null || true
  pct destroy "$CT_ID" --force
fi

# ── Confirm ──────────────────────────────────────────────────────────────────
PG_PASSWORD_DISPLAY="${PG_PASSWORD:0:8}..."

confirm_settings "PostgreSQL LXC — CT $CT_ID" \
  "CT_ID=$CT_ID" \
  "CT_HOSTNAME=$CT_HOSTNAME" \
  "CT_STORAGE=$CT_STORAGE (${CT_DISK}GB)" \
  "CT_MEMORY=${CT_MEMORY}MB / ${CT_SWAP}MB swap / ${CT_CORES} cores" \
  "NET_IP=$NET_IP (gw $NET_GW)" \
  "PG_VERSION=$PG_VERSION" \
  "PG_DB=$PG_DB" \
  "PG_USER=$PG_USER" \
  "PG_PASSWORD=$PG_PASSWORD_DISPLAY" \
  "PG_ALLOWED_NETWORK=$PG_ALLOWED_NETWORK" \
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

# ── Install PostgreSQL ───────────────────────────────────────────────────────
log_info "Adding PGDG repository and installing PostgreSQL $PG_VERSION..."
exec_ct "$CT_ID" "curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
  gpg --dearmor -o /usr/share/keyrings/postgresql.gpg && \
  echo \"deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
    http://apt.postgresql.org/pub/repos/apt \$(lsb_release -cs)-pgdg main\" \
    > /etc/apt/sources.list.d/pgdg.list && \
  apt-get update -qq && apt-get install -y -qq postgresql-${PG_VERSION}"
log_ok "PostgreSQL $PG_VERSION installed"

# ── Configure PostgreSQL ─────────────────────────────────────────────────────
log_info "Configuring PostgreSQL..."

PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"

exec_ct "$CT_ID" "cat >> ${PG_CONF} <<PGCONF

# ninja-ops configuration
listen_addresses = '*'
max_connections = ${PG_MAX_CONNECTIONS}
shared_buffers = ${PG_SHARED_BUFFERS}
timezone = '${TZ}'
log_timezone = '${TZ}'
PGCONF"

exec_ct "$CT_ID" "echo 'host  ${PG_DB}  ${PG_USER}  ${PG_ALLOWED_NETWORK}  scram-sha-256' >> ${PG_HBA}"
log_ok "PostgreSQL configured"

# ── Create database and user ─────────────────────────────────────────────────
log_info "Creating database and user..."
exec_ct "$CT_ID" "systemctl restart postgresql"

exec_ct "$CT_ID" "su -c \"psql -c \\\"CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASSWORD}'\\\"\" postgres" 2>/dev/null || \
  log_warn "User ${PG_USER} may already exist"

exec_ct "$CT_ID" "su -c \"psql -c \\\"CREATE DATABASE ${PG_DB} OWNER ${PG_USER}\\\"\" postgres" 2>/dev/null || \
  log_warn "Database ${PG_DB} may already exist"

exec_ct "$CT_ID" "systemctl restart postgresql && systemctl enable postgresql"
log_ok "PostgreSQL is running and enabled"

# ── Verify ───────────────────────────────────────────────────────────────────
log_info "Verifying PostgreSQL..."
exec_ct "$CT_ID" "su -c \"psql -d ${PG_DB} -c 'SELECT 1'\" postgres" >/dev/null
log_ok "PostgreSQL is responding"

# ── Summary ──────────────────────────────────────────────────────────────────
NET_IP_BARE=$(strip_cidr "$NET_IP")

printf '\n'
print_box_top
print_box_title "PostgreSQL Ready"
print_box_mid
print_box_blank
print_box_kv "Container" "CT $CT_ID ($CT_HOSTNAME)"
print_box_kv "Address" "$NET_IP_BARE:5432"
print_box_kv "Database" "$PG_DB"
print_box_kv "User" "$PG_USER"
print_box_kv "Password" "$PG_PASSWORD"
print_box_kv "Connection URL" "postgres://${PG_USER}:${PG_PASSWORD}@${NET_IP_BARE}:5432/${PG_DB}"
print_box_blank
print_box_bot
printf '\n'

log_ok "Done. Save the connection URL above — you will need it for setup-control-plane.sh"
