#!/bin/bash
# setup-redis.sh — Provision a Redis LXC container on Proxmox VE
# Self-contained: can be curl-piped or run from the scripts/ directory.
#
# Usage:
#   bash setup-redis.sh [--yes] [--force] [--help]
#   curl -sSL <url>/setup-redis.sh | bash
#   REDIS_PASSWORD=mysecret CT_ID=201 bash setup-redis.sh --yes

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
Usage: setup-redis.sh [OPTIONS]

Provision a Redis LXC container on Proxmox VE.

Options:
  --yes, -y    Skip confirmation prompt
  --force      Recreate container if it already exists
  --help, -h   Show this help message

Environment variables (all optional):
  CT_ID                 Container ID (default: 201)
  CT_HOSTNAME           Hostname (default: redis-01)
  CT_STORAGE            Storage pool (default: local-lvm)
  CT_DISK               Disk size in GB (default: 4)
  CT_MEMORY             Memory in MB (default: 512)
  CT_SWAP               Swap in MB (default: 256)
  CT_CORES              CPU cores (default: 1)
  CT_TEMPLATE_STORAGE   Template storage (default: local)
  CT_TEMPLATE_DISTRO    Distro pattern (default: debian-12)
  NET_BRIDGE            Network bridge (default: vmbr0)
  NET_IP                IP with CIDR (default: 10.0.0.11/24)
  NET_GW                Gateway (default: 10.0.0.1)
  NET_DNS               DNS server (default: 1.1.1.1)
  REDIS_PASSWORD        Password (default: empty = no auth)
  REDIS_MAXMEMORY       Max memory (default: 256mb)
  REDIS_MAXMEMORY_POLICY  Eviction policy (default: noeviction)
  TZ                    Timezone (default: Pacific/Auckland)
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
CT_ID="${CT_ID:-101}"
CT_HOSTNAME="${CT_HOSTNAME:-redis-01}"
CT_STORAGE="${CT_STORAGE:-local-lvm}"
CT_DISK="${CT_DISK:-4}"
CT_MEMORY="${CT_MEMORY:-512}"
CT_SWAP="${CT_SWAP:-256}"
CT_CORES="${CT_CORES:-1}"
CT_TEMPLATE_STORAGE="${CT_TEMPLATE_STORAGE:-local}"
CT_TEMPLATE_DISTRO="${CT_TEMPLATE_DISTRO:-debian-13}"
NET_BRIDGE="${NET_BRIDGE:-vmbr0}"
NET_IP="${NET_IP:-10.0.0.11/24}"
NET_GW="${NET_GW:-10.0.0.1}"
NET_DNS="${NET_DNS:-1.1.1.1}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"
REDIS_MAXMEMORY="${REDIS_MAXMEMORY:-256mb}"
REDIS_MAXMEMORY_POLICY="${REDIS_MAXMEMORY_POLICY:-noeviction}"
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
  log_info "Redis"
  printf '\n'
  if [ "${OPT_USE_ENV:-0}" -eq 0 ]; then
    _redis_pw_display="${REDIS_PASSWORD:-(none)}"
    prompt_default "Password" "$_redis_pw_display" "leave empty for no auth"
    [ "$REPLY" = "(none)" ] && REDIS_PASSWORD="" || REDIS_PASSWORD="$REPLY"
  fi
  prompt_default "Max memory" "$REDIS_MAXMEMORY" "128mb, 256mb, 512mb"
  REDIS_MAXMEMORY="$REPLY"
  prompt_default "Eviction policy" "$REDIS_MAXMEMORY_POLICY" "noeviction, allkeys-lru, volatile-lru"
  REDIS_MAXMEMORY_POLICY="$REPLY"
  printf '\n'
fi

# ── Preflight ────────────────────────────────────────────────────────────────
check_proxmox_host

if [ "${OPT_FORCE:-0}" -eq 1 ] && pct status "$CT_ID" >/dev/null 2>&1; then
  log_warn "Destroying existing CT $CT_ID (--force)"
  pct stop "$CT_ID" 2>/dev/null || true
  pct destroy "$CT_ID" --force
fi

# ── Confirm ──────────────────────────────────────────────────────────────────
_redis_auth_display="(none)"
[ -n "$REDIS_PASSWORD" ] && _redis_auth_display="${REDIS_PASSWORD:0:8}..."

confirm_settings "Redis LXC — CT $CT_ID" \
  "CT_ID=$CT_ID" \
  "CT_HOSTNAME=$CT_HOSTNAME" \
  "CT_STORAGE=$CT_STORAGE (${CT_DISK}GB)" \
  "CT_MEMORY=${CT_MEMORY}MB / ${CT_SWAP}MB swap / ${CT_CORES} core" \
  "NET_IP=$NET_IP (gw $NET_GW)" \
  "REDIS_PASSWORD=$_redis_auth_display" \
  "REDIS_MAXMEMORY=$REDIS_MAXMEMORY" \
  "REDIS_MAXMEMORY_POLICY=$REDIS_MAXMEMORY_POLICY" \
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

# ── Install Redis ────────────────────────────────────────────────────────────
log_info "Installing Redis..."
exec_ct "$CT_ID" "apt-get install -y -qq redis-server"
log_ok "Redis installed"

# ── Configure Redis ──────────────────────────────────────────────────────────
log_info "Configuring Redis..."

REDIS_CONF="/etc/redis/redis.conf"

# Build sed commands for configuration
exec_ct "$CT_ID" "sed -i 's/^bind .*/bind 0.0.0.0/' ${REDIS_CONF}"
exec_ct "$CT_ID" "sed -i 's/^protected-mode yes/protected-mode no/' ${REDIS_CONF}"
exec_ct "$CT_ID" "sed -i 's/^# maxmemory .*/maxmemory ${REDIS_MAXMEMORY}/' ${REDIS_CONF}"
exec_ct "$CT_ID" "grep -q '^maxmemory ' ${REDIS_CONF} || echo 'maxmemory ${REDIS_MAXMEMORY}' >> ${REDIS_CONF}"
exec_ct "$CT_ID" "sed -i 's/^# maxmemory-policy .*/maxmemory-policy ${REDIS_MAXMEMORY_POLICY}/' ${REDIS_CONF}"
exec_ct "$CT_ID" "grep -q '^maxmemory-policy ' ${REDIS_CONF} || echo 'maxmemory-policy ${REDIS_MAXMEMORY_POLICY}' >> ${REDIS_CONF}"
exec_ct "$CT_ID" "sed -i 's/^appendonly no/appendonly yes/' ${REDIS_CONF}"

if [ -n "$REDIS_PASSWORD" ]; then
  exec_ct "$CT_ID" "sed -i 's/^# requirepass .*/requirepass ${REDIS_PASSWORD}/' ${REDIS_CONF}"
  exec_ct "$CT_ID" "grep -q '^requirepass ' ${REDIS_CONF} || echo 'requirepass ${REDIS_PASSWORD}' >> ${REDIS_CONF}"
fi

log_ok "Redis configured"

# ── Start Redis ──────────────────────────────────────────────────────────────
log_info "Starting Redis..."
exec_ct "$CT_ID" "systemctl restart redis-server && systemctl enable redis-server"
log_ok "Redis is running and enabled"

# ── Verify ───────────────────────────────────────────────────────────────────
log_info "Verifying Redis..."
if [ -n "$REDIS_PASSWORD" ]; then
  exec_ct "$CT_ID" "redis-cli -a '${REDIS_PASSWORD}' --no-auth-warning ping" | grep -q PONG
else
  exec_ct "$CT_ID" "redis-cli ping" | grep -q PONG
fi
log_ok "Redis is responding (PONG)"

# ── Summary ──────────────────────────────────────────────────────────────────
NET_IP_BARE=$(strip_cidr "$NET_IP")

if [ -n "$REDIS_PASSWORD" ]; then
  REDIS_URL="redis://:${REDIS_PASSWORD}@${NET_IP_BARE}:6379"
else
  REDIS_URL="redis://${NET_IP_BARE}:6379"
fi

printf '\n'
print_box_top
print_box_title "Redis Ready"
print_box_mid
print_box_blank
print_box_kv "Container" "CT $CT_ID ($CT_HOSTNAME)"
print_box_kv "Address" "$NET_IP_BARE:6379"
print_box_kv "Password" "${REDIS_PASSWORD:-(none)}"
print_box_kv "Connection URL" "$REDIS_URL"
print_box_blank
print_box_bot
printf '\n'

log_ok "Done. Save the connection URL above — you will need it for setup-control-plane.sh"
