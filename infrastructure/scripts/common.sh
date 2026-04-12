#!/bin/bash
# common.sh — Shared functions for ninja-ops LXC provisioning scripts
# Sourced by setup-*.sh when available; each script also inlines fallbacks
# so it can be curl-piped independently.

set -euo pipefail

# ── Colour support ────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -n "${TERM:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  C_RED=$(printf '\033[0;31m')
  C_GRN=$(printf '\033[0;32m')
  C_YLW=$(printf '\033[0;33m')
  C_CYN=$(printf '\033[0;36m')
  C_BLD=$(printf '\033[1m')
  C_RST=$(printf '\033[0m')
else
  C_RED=''
  C_GRN=''
  C_YLW=''
  C_CYN=''
  C_BLD=''
  C_RST=''
fi

# ── Logging helpers ───────────────────────────────────────────────────────────
log_info() { printf '%s[ninja]%s %s\n'          "$C_CYN" "$C_RST" "$1"; }
log_ok()   { printf '%s[ninja]%s %s✓%s %s\n'   "$C_CYN" "$C_RST" "$C_GRN" "$C_RST" "$1"; }
log_warn() { printf '%s[ninja]%s %s⚠%s  %s\n'  "$C_CYN" "$C_RST" "$C_YLW" "$C_RST" "$1"; }
log_fail() { printf '%s[ninja]%s %s✗%s %s\n'   "$C_CYN" "$C_RST" "$C_RED" "$C_RST" "$1" >&2; }
die()      { log_fail "$1"; exit 1; }

# ── Secret generation ────────────────────────────────────────────────────────
gen_secret() { openssl rand -hex "$1"; }

# ── Proxmox host check ───────────────────────────────────────────────────────
check_proxmox_host() {
  command -v pct  >/dev/null 2>&1 || die "pct not found — run this on a Proxmox VE host"
  command -v pvesh >/dev/null 2>&1 || die "pvesh not found — run this on a Proxmox VE host"
}

# ── Template helpers ─────────────────────────────────────────────────────────
find_latest_template() {  # $1 = distro pattern (e.g. "debian-12")
  pveam available --section system | grep "$1" | sort -V | tail -1 | awk '{print $2}'
}

download_template() {  # $1 = storage, $2 = template name
  pveam list "$1" | grep -q "$2" || pveam download "$1" "$2"
}

# ── LXC creation ─────────────────────────────────────────────────────────────
# Expects caller to have set: CT_ID, CT_HOSTNAME, CT_STORAGE, CT_DISK,
# CT_MEMORY, CT_SWAP, CT_CORES, CT_TEMPLATE_STORAGE, TEMPLATE,
# NET_BRIDGE, NET_IP, NET_GW, NET_DNS
create_lxc() {
  if pct status "$CT_ID" >/dev/null 2>&1; then
    log_warn "CT $CT_ID already exists — skipping create"
  else
    pct create "$CT_ID" "${CT_TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
      --hostname "$CT_HOSTNAME" \
      --storage  "$CT_STORAGE" \
      --rootfs   "${CT_STORAGE}:${CT_DISK}" \
      --memory   "$CT_MEMORY" \
      --swap     "$CT_SWAP" \
      --cores    "$CT_CORES" \
      --net0     "name=eth0,bridge=${NET_BRIDGE},ip=${NET_IP},gw=${NET_GW}" \
      --nameserver "$NET_DNS" \
      --unprivileged 1 \
      --features nesting=1 \
      --start    1
  fi

  pct status "$CT_ID" | grep -q running || pct start "$CT_ID"

  # Wait for network
  local i=0
  while [ "$i" -lt 30 ]; do
    pct exec "$CT_ID" -- ping -c1 -W1 8.8.8.8 >/dev/null 2>&1 && break
    sleep 2
    i=$((i + 1))
  done
  [ "$i" -lt 30 ] || die "CT $CT_ID did not get network after 60s"
}

# ── Exec helper ──────────────────────────────────────────────────────────────
exec_ct() { pct exec "$1" -- bash -c "$2"; }

# ── Base package installation ────────────────────────────────────────────────
install_base_packages() {  # $1 = CT_ID
  exec_ct "$1" "apt-get update -qq && apt-get upgrade -y -qq && \
    apt-get install -y -qq curl wget gnupg ca-certificates sudo htop lsb-release git"
}

# ── Locale and timezone ─────────────────────────────────────────────────────
configure_locale_timezone() {  # $1 = CT_ID, $2 = timezone
  exec_ct "$1" "ln -sf /usr/share/zoneinfo/$2 /etc/localtime && \
    dpkg-reconfigure -f noninteractive tzdata && \
    apt-get install -y -qq locales && \
    sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && \
    locale-gen"
}

# ── Interactive prompt ───────────────────────────────────────────────────────
# prompt_default "Label" "default" ["hint"]  — result stored in $REPLY
prompt_default() {
  local _hint=""
  [ -n "${3:-}" ] && _hint=" ${C_YLW}(e.g. $3)${C_RST}"
  printf '%s[ninja]%s %s [%s]%s: ' "$C_CYN" "$C_RST" "$1" "$2" "$_hint" >/dev/tty
  read -r REPLY </dev/tty
  [ -z "$REPLY" ] && REPLY="$2"
}

# ── Flag parsing ─────────────────────────────────────────────────────────────
OPT_YES=${OPT_YES:-0}
OPT_FORCE=${OPT_FORCE:-0}

parse_common_flags() {
  for _arg in "$@"; do
    case "$_arg" in
      --yes|-y)   OPT_YES=1 ;;
      --force)    OPT_FORCE=1 ;;
      --help|-h)  show_help; exit 0 ;;
    esac
  done
}

# ── Box drawing ──────────────────────────────────────────────────────────────
_BOX_INNER=68

_print_n_chars() {
  local _c="$1" _n="$2" _i=0
  while [ "$_i" -lt "$_n" ]; do
    printf '%s' "$_c"
    _i=$((_i + 1))
  done
}

print_box_top() { printf '╔'; _print_n_chars '═' "$_BOX_INNER"; printf '╗\n'; }
print_box_mid() { printf '╠'; _print_n_chars '═' "$_BOX_INNER"; printf '╣\n'; }
print_box_bot() { printf '╚'; _print_n_chars '═' "$_BOX_INNER"; printf '╝\n'; }

print_box_title() {
  local _t="$1" _tlen=${#1}
  local _pad_l=$(( (_BOX_INNER - _tlen) / 2 ))
  local _pad_r=$(( _BOX_INNER - _tlen - _pad_l ))
  printf '║'
  _print_n_chars ' ' "$_pad_l"
  printf '%s' "$_t"
  _print_n_chars ' ' "$_pad_r"
  printf '║\n'
}

print_box_blank() { printf '║\n'; }

print_box_kv() {
  printf '║  %s =\n' "$1"
  printf '║    %s\n' "$2"
}

# ── Confirmation prompt ─────────────────────────────────────────────────────
# Prints a summary box and prompts for confirmation unless OPT_YES=1.
# Usage: confirm_settings "Title" "key1=val1" "key2=val2" ...
confirm_settings() {
  local _title="$1"; shift

  printf '\n'
  print_box_top
  print_box_title "$_title"
  print_box_mid
  print_box_blank

  for _kv in "$@"; do
    local _key="${_kv%%=*}"
    local _val="${_kv#*=}"
    print_box_kv "$_key" "$_val"
  done

  print_box_blank
  print_box_bot
  printf '\n'

  if [ "${OPT_YES:-0}" -eq 1 ]; then
    log_info "Proceeding (--yes)"
    return 0
  fi

  printf '%sProceed with these settings? [Y/n]:%s ' "$C_YLW" "$C_RST" >/dev/tty
  read -r _confirm </dev/tty
  case "$_confirm" in
    n|N|no|NO) die "Aborted by user." ;;
    *) return 0 ;;
  esac
}

# ── IP helper ────────────────────────────────────────────────────────────────
# Strip CIDR suffix: 10.0.0.10/24 → 10.0.0.10
strip_cidr() { printf '%s' "${1%%/*}"; }

# Mark common.sh as loaded
_NINJA_COMMON_LOADED=1
