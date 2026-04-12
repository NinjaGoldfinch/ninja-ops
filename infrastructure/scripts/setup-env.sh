#!/bin/bash
# setup-env.sh — Interactive configuration wizard for ninja-ops deployment
# Generates ninja-ops.env with all settings for the 4 LXC containers.
#
# Usage:
#   bash setup-env.sh [--out /path/to/file]

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -n "${TERM:-}" ] && [ "${TERM:-}" != "dumb" ]; then
  C_YLW=$(printf '\033[0;33m')
  C_CYN=$(printf '\033[0;36m')
  C_GRN=$(printf '\033[0;32m')
  C_RST=$(printf '\033[0m')
else
  C_YLW=''; C_CYN=''; C_GRN=''; C_RST=''
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
log_info() { printf '%s[ninja]%s %s\n'        "$C_CYN" "$C_RST" "$1"; }
log_ok()   { printf '%s[ninja]%s %s✓%s %s\n' "$C_CYN" "$C_RST" "$C_GRN" "$C_RST" "$1"; }
die()      { printf '%s[ninja]%s %s✗%s %s\n' "$C_CYN" "$C_RST" '\033[0;31m' "$C_RST" "$1" >&2; exit 1; }

# prompt_default "Label" "default" ["hint"] — result in $REPLY
prompt_default() {
  local _hint=""
  [ -n "${3:-}" ] && _hint=" ${C_YLW}(e.g. $3)${C_RST}"
  printf '%s[ninja]%s %s [%s]%s: ' "$C_CYN" "$C_RST" "$1" "$2" "$_hint" >/dev/tty
  read -r REPLY </dev/tty
  REPLY="${REPLY:-$2}"
}

# prompt_secret "Label" — result in $REPLY
prompt_secret() {
  printf '%s[ninja]%s %s: ' "$C_CYN" "$C_RST" "$1" >/dev/tty
  read -r -s REPLY </dev/tty
  printf '\n' >/dev/tty
}

# gen_secret N — outputs hex string
gen_secret() { openssl rand -hex "$1"; }

# ── Parse flags ───────────────────────────────────────────────────────────────
OUT_FILE="ninja-ops.env"

while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      shift
      [ -n "${1:-}" ] || die "--out requires a file path argument"
      OUT_FILE="$1"
      ;;
    --help|-h)
      printf 'Usage: bash setup-env.sh [--out /path/to/file]\n'
      printf '\nGenerates a ninja-ops.env file with configuration for all 4 LXC containers.\n'
      exit 0
      ;;
    *)
      die "Unknown option: $1 (use --help)"
      ;;
  esac
  shift
done

# ── Banner ────────────────────────────────────────────────────────────────────
printf '\n'
printf '%s╔══════════════════════════════════════════════════════════════════════╗%s\n' "$C_CYN" "$C_RST" >/dev/tty
printf '%s║          ninja-ops deployment configuration wizard                  ║%s\n' "$C_CYN" "$C_RST" >/dev/tty
printf '%s╚══════════════════════════════════════════════════════════════════════╝%s\n' "$C_CYN" "$C_RST" >/dev/tty
printf '\n' >/dev/tty
printf 'Press Enter to accept defaults. Output: %s%s%s\n\n' "$C_YLW" "$OUT_FILE" "$C_RST" >/dev/tty

# ── Secrets & Admin ───────────────────────────────────────────────────────────
log_info "━━━ Secrets & Admin ..."

prompt_default "Admin username" "admin"
ADMIN_USERNAME="$REPLY"

prompt_secret "Admin password (blank = auto-generate)"
if [ -z "$REPLY" ]; then
  ADMIN_PASSWORD=$(gen_secret 12)
else
  ADMIN_PASSWORD="$REPLY"
fi

prompt_secret "PostgreSQL password (blank = auto-generate)"
if [ -z "$REPLY" ]; then
  PG_PASSWORD=$(gen_secret 16)
else
  PG_PASSWORD="$REPLY"
fi

prompt_secret "Redis password (blank = no auth)"
REDIS_PASSWORD="$REPLY"

JWT_SECRET=$(gen_secret 64)
ENCRYPTION_KEY=$(gen_secret 32)
AGENT_SECRET=$(gen_secret 64)
GITHUB_WEBHOOK_SECRET=$(gen_secret 32)

# ── PostgreSQL Container ──────────────────────────────────────────────────────
printf '\n' >/dev/tty
log_info "━━━ PostgreSQL Container ..."

prompt_default "VMID" "100" "any unused Proxmox CT ID"
PG_CT_ID="$REPLY"

prompt_default "Hostname" "postgres-01"
PG_HOSTNAME="$REPLY"

prompt_default "Storage pool" "local-lvm" "local-lvm, local, zfspool"
PG_STORAGE="$REPLY"

prompt_default "Timezone" "Pacific/Auckland" "UTC, Europe/London, America/New_York"
PG_TZ="$REPLY"

prompt_default "IP/CIDR" "10.0.0.10/24" "10.0.0.x/24 or dhcp"
PG_NET_IP="$REPLY"

if [ "$PG_NET_IP" != "dhcp" ]; then
  prompt_default "Gateway" "10.0.0.1"
  PG_NET_GW="$REPLY"
else
  PG_NET_GW=""
fi

prompt_default "DNS" "1.1.1.1" "1.1.1.1, 8.8.8.8"
PG_NET_DNS="$REPLY"

prompt_default "Bridge" "vmbr0" "vmbr0, vmbr1"
PG_NET_BRIDGE="$REPLY"

prompt_default "Disk (GB)" "8" "minimum 4"
PG_DISK="$REPLY"

prompt_default "Memory (MB)" "1024" "512, 1024, 2048"
PG_MEMORY="$REPLY"

prompt_default "Swap (MB)" "512"
PG_SWAP="$REPLY"

prompt_default "Cores" "2" "1, 2, 4"
PG_CORES="$REPLY"

prompt_default "PostgreSQL version" "18" "17, 18"
PG_VERSION="$REPLY"

prompt_default "Database name" "ninja_ops"
PG_DB="$REPLY"

prompt_default "Database user" "ninja"
PG_USER="$REPLY"

prompt_default "Allowed network" "10.0.0.0/24" "10.0.0.0/24, 0.0.0.0/0"
PG_ALLOWED_NETWORK="$REPLY"

# ── Redis Container ───────────────────────────────────────────────────────────
printf '\n' >/dev/tty
log_info "━━━ Redis Container ..."

prompt_default "VMID" "101"
REDIS_CT_ID="$REPLY"

prompt_default "Hostname" "redis-01"
REDIS_HOSTNAME="$REPLY"

prompt_default "Storage pool" "local-lvm"
REDIS_STORAGE="$REPLY"

prompt_default "Timezone" "$PG_TZ"
REDIS_TZ="$REPLY"

prompt_default "IP/CIDR" "10.0.0.11/24" "10.0.0.x/24 or dhcp"
REDIS_NET_IP="$REPLY"

if [ "$REDIS_NET_IP" != "dhcp" ]; then
  prompt_default "Gateway" "10.0.0.1"
  REDIS_NET_GW="$REPLY"
else
  REDIS_NET_GW=""
fi

prompt_default "DNS" "1.1.1.1"
REDIS_NET_DNS="$REPLY"

prompt_default "Bridge" "vmbr0"
REDIS_NET_BRIDGE="$REPLY"

prompt_default "Disk (GB)" "4"
REDIS_DISK="$REPLY"

prompt_default "Memory (MB)" "512" "256, 512, 1024"
REDIS_MEMORY="$REPLY"

prompt_default "Swap (MB)" "256"
REDIS_SWAP="$REPLY"

prompt_default "Cores" "1"
REDIS_CORES="$REPLY"

prompt_default "Max memory" "256mb" "128mb, 256mb, 512mb"
REDIS_MAXMEMORY="$REPLY"

prompt_default "Eviction policy" "noeviction" "noeviction, allkeys-lru"
REDIS_MAXMEMORY_POLICY="$REPLY"

# ── Control Plane Container ───────────────────────────────────────────────────
printf '\n' >/dev/tty
log_info "━━━ Control Plane Container ..."

prompt_default "VMID" "102"
CP_CT_ID="$REPLY"

prompt_default "Hostname" "control-plane-01"
CP_HOSTNAME="$REPLY"

prompt_default "Storage pool" "local-lvm"
CP_STORAGE="$REPLY"

prompt_default "Timezone" "$PG_TZ"
CP_TZ="$REPLY"

prompt_default "IP/CIDR" "10.0.0.20/24"
CP_NET_IP="$REPLY"

if [ "$CP_NET_IP" != "dhcp" ]; then
  prompt_default "Gateway" "10.0.0.1"
  CP_NET_GW="$REPLY"
else
  CP_NET_GW=""
fi

prompt_default "DNS" "1.1.1.1"
CP_NET_DNS="$REPLY"

prompt_default "Bridge" "vmbr0"
CP_NET_BRIDGE="$REPLY"

prompt_default "Disk (GB)" "8"
CP_DISK="$REPLY"

prompt_default "Memory (MB)" "2048" "1024, 2048, 4096"
CP_MEMORY="$REPLY"

prompt_default "Swap (MB)" "512"
CP_SWAP="$REPLY"

prompt_default "Cores" "2"
CP_CORES="$REPLY"

prompt_default "API port" "3000" "3000, 8080"
CP_PORT="$REPLY"

prompt_default "Repo branch" "main" "main, develop"
CP_REPO_BRANCH="$REPLY"

prompt_default "GitHub token" "" "leave blank for public"
CP_GITHUB_TOKEN="$REPLY"

# ── Dashboard Container ───────────────────────────────────────────────────────
printf '\n' >/dev/tty
log_info "━━━ Dashboard Container ..."

prompt_default "VMID" "103"
DASH_CT_ID="$REPLY"

prompt_default "Hostname" "dashboard-01"
DASH_HOSTNAME="$REPLY"

prompt_default "Storage pool" "local-lvm"
DASH_STORAGE="$REPLY"

prompt_default "Timezone" "$PG_TZ"
DASH_TZ="$REPLY"

prompt_default "IP/CIDR" "10.0.0.21/24"
DASH_NET_IP="$REPLY"

if [ "$DASH_NET_IP" != "dhcp" ]; then
  prompt_default "Gateway" "10.0.0.1"
  DASH_NET_GW="$REPLY"
else
  DASH_NET_GW=""
fi

prompt_default "DNS" "1.1.1.1"
DASH_NET_DNS="$REPLY"

prompt_default "Bridge" "vmbr0"
DASH_NET_BRIDGE="$REPLY"

prompt_default "Disk (GB)" "4"
DASH_DISK="$REPLY"

prompt_default "Memory (MB)" "512"
DASH_MEMORY="$REPLY"

prompt_default "Swap (MB)" "256"
DASH_SWAP="$REPLY"

prompt_default "Cores" "1"
DASH_CORES="$REPLY"

prompt_default "Serve port" "8080" "8080, 3001"
DASH_SERVE_PORT="$REPLY"

_cp_ip_bare="${CP_NET_IP%%/*}"
_vite_default="http://${_cp_ip_bare}:${CP_PORT}"
prompt_default "Control plane API URL" "$_vite_default" "http://10.0.0.20:3000"
DASH_VITE_API_URL="$REPLY"

# ── Derive connection URLs ────────────────────────────────────────────────────
_pg_ip_bare="${PG_NET_IP%%/*}"
_redis_ip_bare="${REDIS_NET_IP%%/*}"

if [ "$PG_NET_IP" = "dhcp" ]; then
  DATABASE_URL="postgres://${PG_USER}:${PG_PASSWORD}@<pg-ip>:5432/${PG_DB}"
else
  DATABASE_URL="postgres://${PG_USER}:${PG_PASSWORD}@${_pg_ip_bare}:5432/${PG_DB}"
fi

if [ "$REDIS_NET_IP" = "dhcp" ]; then
  if [ -n "$REDIS_PASSWORD" ]; then
    REDIS_URL="redis://:${REDIS_PASSWORD}@<redis-ip>:6379"
  else
    REDIS_URL="redis://<redis-ip>:6379"
  fi
else
  if [ -n "$REDIS_PASSWORD" ]; then
    REDIS_URL="redis://:${REDIS_PASSWORD}@${_redis_ip_bare}:6379"
  else
    REDIS_URL="redis://${_redis_ip_bare}:6379"
  fi
fi

# ── Write env file ────────────────────────────────────────────────────────────
cat > "$OUT_FILE" <<EOF
# ninja-ops deployment configuration
# Generated $(date)
# Source with: set -a; source ninja-ops.env; set +a

# ── Secrets & Auth
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PG_PASSWORD=${PG_PASSWORD}
DATABASE_URL=${DATABASE_URL}
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=${REDIS_URL}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
AGENT_SECRET=${AGENT_SECRET}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}

# ── PostgreSQL (CT ${PG_CT_ID})
PG_CT_ID=${PG_CT_ID}
PG_HOSTNAME=${PG_HOSTNAME}
PG_STORAGE=${PG_STORAGE}
PG_TZ=${PG_TZ}
PG_NET_IP=${PG_NET_IP}
PG_NET_GW=${PG_NET_GW}
PG_NET_DNS=${PG_NET_DNS}
PG_NET_BRIDGE=${PG_NET_BRIDGE}
PG_DISK=${PG_DISK}
PG_MEMORY=${PG_MEMORY}
PG_SWAP=${PG_SWAP}
PG_CORES=${PG_CORES}
PG_VERSION=${PG_VERSION}
PG_DB=${PG_DB}
PG_USER=${PG_USER}
PG_ALLOWED_NETWORK=${PG_ALLOWED_NETWORK}

# ── Redis (CT ${REDIS_CT_ID})
REDIS_CT_ID=${REDIS_CT_ID}
REDIS_HOSTNAME=${REDIS_HOSTNAME}
REDIS_STORAGE=${REDIS_STORAGE}
REDIS_TZ=${REDIS_TZ}
REDIS_NET_IP=${REDIS_NET_IP}
REDIS_NET_GW=${REDIS_NET_GW}
REDIS_NET_DNS=${REDIS_NET_DNS}
REDIS_NET_BRIDGE=${REDIS_NET_BRIDGE}
REDIS_DISK=${REDIS_DISK}
REDIS_MEMORY=${REDIS_MEMORY}
REDIS_SWAP=${REDIS_SWAP}
REDIS_CORES=${REDIS_CORES}
REDIS_MAXMEMORY=${REDIS_MAXMEMORY}
REDIS_MAXMEMORY_POLICY=${REDIS_MAXMEMORY_POLICY}

# ── Control Plane (CT ${CP_CT_ID})
CP_CT_ID=${CP_CT_ID}
CP_HOSTNAME=${CP_HOSTNAME}
CP_STORAGE=${CP_STORAGE}
CP_TZ=${CP_TZ}
CP_NET_IP=${CP_NET_IP}
CP_NET_GW=${CP_NET_GW}
CP_NET_DNS=${CP_NET_DNS}
CP_NET_BRIDGE=${CP_NET_BRIDGE}
CP_DISK=${CP_DISK}
CP_MEMORY=${CP_MEMORY}
CP_SWAP=${CP_SWAP}
CP_CORES=${CP_CORES}
CP_PORT=${CP_PORT}
CP_REPO_BRANCH=${CP_REPO_BRANCH}
CP_GITHUB_TOKEN=${CP_GITHUB_TOKEN}

# ── Dashboard (CT ${DASH_CT_ID})
DASH_CT_ID=${DASH_CT_ID}
DASH_HOSTNAME=${DASH_HOSTNAME}
DASH_STORAGE=${DASH_STORAGE}
DASH_TZ=${DASH_TZ}
DASH_NET_IP=${DASH_NET_IP}
DASH_NET_GW=${DASH_NET_GW}
DASH_NET_DNS=${DASH_NET_DNS}
DASH_NET_BRIDGE=${DASH_NET_BRIDGE}
DASH_DISK=${DASH_DISK}
DASH_MEMORY=${DASH_MEMORY}
DASH_SWAP=${DASH_SWAP}
DASH_CORES=${DASH_CORES}
DASH_SERVE_PORT=${DASH_SERVE_PORT}
DASH_VITE_API_URL=${DASH_VITE_API_URL}
EOF

printf '\n'
printf '%s── Review your configuration ──%s\n\n' "$C_YLW" "$C_RST" >/dev/tty
cat "$OUT_FILE" >/dev/tty
printf '\n%s── Save the secrets above to your password manager ──%s\n' "$C_YLW" "$C_RST" >/dev/tty
printf '%sPress Enter once saved...%s ' "$C_YLW" "$C_RST" >/dev/tty
read -r _ </dev/tty
log_ok "Config written to ${OUT_FILE}"
printf '\n'
log_info "Next steps:"
printf '  set -a; source %s; set +a\n' "$OUT_FILE"
printf '  bash setup-postgres.sh\n'
printf '  bash setup-redis.sh\n'
printf '  bash setup-control-plane.sh\n'
printf '  bash setup-dashboard.sh\n'
printf '\n'
