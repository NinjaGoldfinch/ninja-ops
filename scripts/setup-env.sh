#!/bin/sh
# setup-env.sh — First-time environment setup for ninja-ops
# POSIX sh compatible (bash, dash, ash, etc.)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/env/control-plane.env"
ENV_BAK="$REPO_ROOT/env/control-plane.env.bak"
AGENT_ENV_FILE="$REPO_ROOT/env/deploy-agent.env"
COMPOSE_FILE="$REPO_ROOT/docker/docker-compose.yml"

# Port is written into .env as a fixed default; used in summary URLs
PORT=3000

# ── Parse flags ───────────────────────────────────────────────────────────────
OPT_MANUAL=0
OPT_SKIP_DOCKER=0
OPT_SKIP_INSTALL=0
OPT_SKIP_MIGRATE=0
OPT_FORCE=0

for _arg in "$@"; do
  case "$_arg" in
    --manual)        OPT_MANUAL=1 ;;
    --skip-docker)   OPT_SKIP_DOCKER=1 ;;
    --skip-install)  OPT_SKIP_INSTALL=1 ;;
    --skip-migrate)  OPT_SKIP_MIGRATE=1 ;;
    --force)         OPT_FORCE=1 ;;
    --help|-h)
      cat <<'HELP'
Usage: ./setup-env.sh [OPTIONS]

First-time environment setup for ninja-ops.
Generates secrets, writes apps/control-plane/.env, and optionally
starts Docker services, installs dependencies, and runs migrations.

Options:
  --manual        Prompt for every secret instead of auto-generating
  --skip-docker   Do not start Docker services
  --skip-install  Do not run pnpm install
  --skip-migrate  Do not run db:migrate or db:seed
  --force         Overwrite existing .env without prompting
  --help          Show this help message

HELP
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\nRun with --help for usage.\n' "$_arg" >&2
      exit 1
      ;;
  esac
done

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
log_info() { printf '%s[setup]%s %s\n'          "$C_CYN" "$C_RST" "$1"; }
log_ok()   { printf '%s[setup]%s %s✓%s %s\n'   "$C_CYN" "$C_RST" "$C_GRN" "$C_RST" "$1"; }
log_warn() { printf '%s[setup]%s %s⚠%s  %s\n'  "$C_CYN" "$C_RST" "$C_YLW" "$C_RST" "$1"; }
log_fail() { printf '%s[setup]%s %s✗%s %s\n'   "$C_CYN" "$C_RST" "$C_RED" "$C_RST" "$1" >&2; }
die()      { log_fail "$1"; exit 1; }

# ── Generation helpers ────────────────────────────────────────────────────────
# gen_hex <bytes> — print 2*bytes lowercase hex characters
gen_hex() {
  node -e "process.stdout.write(require('crypto').randomBytes($1).toString('hex'))"
}

# prompt_default "Prompt text" "default" — reads into REPLY
prompt_default() {
  printf '%s [%s]: ' "$1" "$2"
  read -r REPLY
  [ -z "$REPLY" ] && REPLY="$2"
}

# prompt_secret "Label" — reads (hidden if possible) into REPLY; loops until non-empty
prompt_secret() {
  while true; do
    printf 'Enter %s: ' "$1"
    if stty -echo 2>/dev/null; then
      read -r REPLY
      stty echo 2>/dev/null
      printf '\n'
    else
      read -r REPLY
    fi
    [ -n "$REPLY" ] && break
    log_warn "Value cannot be empty. Try again."
  done
}

# ── Box drawing ───────────────────────────────────────────────────────────────
# Inner width = 68 chars (box is 70 wide including the two border chars)
_BOX_INNER=68

_print_n_chars() {
  # _print_n_chars <char> <count>
  _c="$1"
  _n="$2"
  _i=0
  while [ "$_i" -lt "$_n" ]; do
    printf '%s' "$_c"
    _i=$((_i + 1))
  done
}

print_box_top() {
  printf '╔'; _print_n_chars '═' "$_BOX_INNER"; printf '╗\n'
}

print_box_mid() {
  printf '╠'; _print_n_chars '═' "$_BOX_INNER"; printf '╣\n'
}

print_box_bot() {
  printf '╚'; _print_n_chars '═' "$_BOX_INNER"; printf '╝\n'
}

# print_box_title "text" — centres text inside the box
print_box_title() {
  _t="$1"
  _tlen=${#_t}
  _pad_l=$(( (_BOX_INNER - _tlen) / 2 ))
  _pad_r=$(( _BOX_INNER - _tlen - _pad_l ))
  printf '║'
  _print_n_chars ' ' "$_pad_l"
  printf '%s' "$_t"
  _print_n_chars ' ' "$_pad_r"
  printf '║\n'
}

# print_box_blank — empty line with left border only (values may exceed box width)
print_box_blank() { printf '║\n'; }

# print_box_kv "KEY" "value" — key on one line, indented value on next
print_box_kv() {
  printf '║  %s =\n' "$1"
  printf '║    %s\n' "$2"
}

# ── Step runner ───────────────────────────────────────────────────────────────
# run_step "Label" cmd [args...] — runs cmd, prints ✓/✗, asks to continue on failure
# Returns 0 on success, 1 if user chose to continue after failure, exits on abort
run_step() {
  _label="$1"
  shift
  log_info "Running: $_label..."
  if "$@"; then
    log_ok "$_label"
    return 0
  else
    log_fail "$_label"
    printf 'Continue anyway? [y/N]: '
    read -r _cont
    case "$_cont" in
      y|Y) log_warn "Continuing despite failure..."; return 1 ;;
      *)   die "Aborted by user." ;;
    esac
  fi
}

# ── Step wrappers (subshells so cd does not affect the script) ────────────────
_step_docker()        { docker compose -f "$COMPOSE_FILE" up -d; }
_step_install()       { ( cd "$REPO_ROOT" && pnpm install ); }
_step_package_agent()     { ( cd "$REPO_ROOT" && pnpm package:agent ); }
_step_package_log_agent() { ( cd "$REPO_ROOT" && pnpm package:log-agent ); }
_step_migrate()       { ( cd "$REPO_ROOT" && pnpm --filter @ninja/control-plane db:migrate ); }
_step_seed()          { ( cd "$REPO_ROOT" && pnpm --filter @ninja/control-plane db:seed ); }

# ─────────────────────────────────────────────────────────────────────────────
#  1. PREREQUISITE CHECKS
# ─────────────────────────────────────────────────────────────────────────────
printf '\n'
log_info "Checking prerequisites..."

# Node.js >= 22
if ! command -v node >/dev/null 2>&1; then
  die "Node.js is not installed. Install Node.js 22+ from https://nodejs.org"
fi
_node_major=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$_node_major" -lt 22 ] 2>/dev/null; then
  die "Node.js 22+ required (found $(node --version)). Please upgrade."
fi
log_ok "Node.js $(node --version)"

# pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  die "pnpm is not installed. Install with: npm install -g pnpm"
fi
log_ok "pnpm $(pnpm --version)"

# Docker (checked only when --skip-docker is not set)
if [ "$OPT_SKIP_DOCKER" -eq 0 ]; then
  if ! command -v docker >/dev/null 2>&1; then
    die "Docker is not installed. See https://docs.docker.com/get-docker/ or pass --skip-docker."
  fi
  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is not running. Start it and retry, or pass --skip-docker."
  fi
  _docker_ver=$(docker --version | awk '{print $3}' | tr -d ',')
  log_ok "Docker $_docker_ver"
fi

# ─────────────────────────────────────────────────────────────────────────────
#  2. HANDLE EXISTING .env
# ─────────────────────────────────────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  if [ "$OPT_FORCE" -eq 1 ]; then
    log_warn "Overwriting existing .env (--force)"
  else
    printf '\n'
    log_warn "env/control-plane.env already exists."
    printf '  %s[o]%s Overwrite\n'                    "$C_YLW" "$C_RST"
    printf '  %s[b]%s Back up to env/control-plane.env.bak and overwrite\n' "$C_YLW" "$C_RST"
    printf '  %s[a]%s Abort\n'                         "$C_YLW" "$C_RST"
    printf 'Choose [o/b/a]: '
    read -r _choice
    case "$_choice" in
      o|O)
        log_info "Overwriting .env"
        ;;
      b|B)
        cp "$ENV_FILE" "$ENV_BAK"
        log_ok "Backed up to env/control-plane.env.bak"
        ;;
      *)
        die "Aborted by user."
        ;;
    esac
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
#  3. GENERATE / COLLECT SECRETS
# ─────────────────────────────────────────────────────────────────────────────
printf '\n'
log_info "Preparing secrets..."

if [ "$OPT_MANUAL" -eq 1 ]; then
  log_info "Manual mode — you will be prompted for each secret."
  printf '\n'
  prompt_secret "JWT_SECRET (paste a 64-byte / 128-hex-char value)";      JWT_SECRET="$REPLY"
  prompt_secret "ENCRYPTION_KEY (paste a 32-byte / 64-hex-char value)";   ENCRYPTION_KEY="$REPLY"
  prompt_secret "AGENT_SECRET (paste a 64-byte / 128-hex-char value)";    AGENT_SECRET="$REPLY"
  prompt_secret "GITHUB_WEBHOOK_SECRET";                                   GITHUB_WEBHOOK_SECRET="$REPLY"
else
  log_info "Auto-generating secrets with Node.js crypto..."
  JWT_SECRET=$(gen_hex 64)
  ENCRYPTION_KEY=$(gen_hex 32)
  AGENT_SECRET=$(gen_hex 64)
  GITHUB_WEBHOOK_SECRET=$(gen_hex 32)
  log_ok "Secrets generated."
fi

# Validate
[ -z "$JWT_SECRET" ]            && die "JWT_SECRET cannot be empty."
[ -z "$ENCRYPTION_KEY" ]        && die "ENCRYPTION_KEY cannot be empty."
[ -z "$AGENT_SECRET" ]          && die "AGENT_SECRET cannot be empty."
[ -z "$GITHUB_WEBHOOK_SECRET" ] && die "GITHUB_WEBHOOK_SECRET cannot be empty."

_enc_len=$(printf '%s' "$ENCRYPTION_KEY" | wc -c | tr -d ' ')
if [ "$_enc_len" -ne 64 ]; then
  die "ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got $_enc_len chars."
fi

# ─────────────────────────────────────────────────────────────────────────────
#  4. PROMPT FOR USER-CONFIGURED VALUES
# ─────────────────────────────────────────────────────────────────────────────
printf '\n'
log_info "Configure connection strings:"
printf '\n'

while true; do
  prompt_default "DATABASE_URL" "postgres://ninja:ninja@localhost:5432/ninja_ops"
  DATABASE_URL="$REPLY"
  case "$DATABASE_URL" in
    postgres://?*) break ;;
    *) log_warn "DATABASE_URL must start with postgres://. Try again." ;;
  esac
done

while true; do
  prompt_default "REDIS_URL" "redis://localhost:6379"
  REDIS_URL="$REPLY"
  case "$REDIS_URL" in
    redis://*) break ;;
    *) log_warn "REDIS_URL must start with redis://. Try again." ;;
  esac
done

prompt_default "CORS_ORIGIN" "http://localhost:5173"
CORS_ORIGIN="$REPLY"

# ─────────────────────────────────────────────────────────────────────────────
#  5. DISPLAY "SAVE THESE" BLOCK
# ─────────────────────────────────────────────────────────────────────────────
printf '\n'

print_box_top
print_box_title "SAVE THESE IN YOUR PASSWORD MANAGER BEFORE CONTINUING"
print_box_mid
print_box_blank
print_box_kv "JWT_SECRET"            "$JWT_SECRET"
print_box_blank
print_box_kv "ENCRYPTION_KEY"        "$ENCRYPTION_KEY"
print_box_blank
print_box_kv "AGENT_SECRET"          "$AGENT_SECRET"
print_box_blank
print_box_kv "GITHUB_WEBHOOK_SECRET" "$GITHUB_WEBHOOK_SECRET"
print_box_blank
print_box_bot

printf '\n'
printf '%sPress Enter once you have saved the above values...%s ' "$C_YLW" "$C_RST"
read -r _dummy
printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
#  6. WRITE .env FILE
# ─────────────────────────────────────────────────────────────────────────────
log_info "Writing env/control-plane.env..."

mkdir -p "$(dirname "$ENV_FILE")"

# Use printf so special characters in user-supplied values are written literally
{
  printf '# Generated by setup-env.sh on %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '# DO NOT COMMIT THIS FILE\n'
  printf '\n'
  printf '# ── Server ──────────────────────────────────────────────\n'
  printf 'PORT=%s\n'     "$PORT"
  printf 'HOST=0.0.0.0\n'
  printf 'NODE_ENV=development\n'
  printf 'LOG_LEVEL=info\n'
  printf '\n'
  printf '# ── Database ─────────────────────────────────────────────\n'
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL"
  printf '\n'
  printf '# ── Redis ───────────────────────────────────────────────\n'
  printf 'REDIS_URL=%s\n' "$REDIS_URL"
  printf '\n'
  printf '# ── Auth ────────────────────────────────────────────────\n'
  printf 'JWT_SECRET=%s\n'  "$JWT_SECRET"
  printf 'JWT_EXPIRY=24h\n'
  printf 'ENCRYPTION_KEY=%s\n' "$ENCRYPTION_KEY"
  printf '\n'
  printf '# ── Agent ───────────────────────────────────────────────\n'
  printf 'AGENT_SECRET=%s\n' "$AGENT_SECRET"
  printf 'AGENT_JWT_EXPIRY=7d\n'
  printf 'AGENT_BUNDLE_PATH=%s/apps/control-plane/agent-bundle.tar.gz\n' "$REPO_ROOT"
  printf 'LOG_AGENT_BUNDLE_PATH=%s/apps/control-plane/log-agent-bundle.tar.gz\n' "$REPO_ROOT"
  printf '\n'
  printf '# ── GitHub Webhooks ─────────────────────────────────────\n'
  printf 'GITHUB_WEBHOOK_SECRET=%s\n' "$GITHUB_WEBHOOK_SECRET"
  printf '\n'
  printf '# ── CORS ────────────────────────────────────────────────\n'
  printf 'CORS_ORIGIN=%s\n' "$CORS_ORIGIN"
  printf '\n'
  printf '# ── Rate Limiting ───────────────────────────────────────\n'
  printf 'RATE_LIMIT_MAX=100\n'
  printf 'RATE_LIMIT_WINDOW=60000\n'
} > "$ENV_FILE"

log_ok "Written to env/control-plane.env"

# ─────────────────────────────────────────────────────────────────────────────
#  6b. WRITE deploy-agent .env FILE
# ─────────────────────────────────────────────────────────────────────────────
log_info "Writing env/deploy-agent.env..."

mkdir -p "$(dirname "$AGENT_ENV_FILE")"

{
  printf '# Generated by setup-env.sh on %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf '# DO NOT COMMIT THIS FILE\n'
  printf '#\n'
  printf '# This file is for running the agent locally (e.g. during development).\n'
  printf '# On each managed LXC container, copy this file and fill in NODE_ID and VMID.\n'
  printf '\n'
  printf '# ── Required — fill in per container ────────────────────────\n'
  printf '# NODE_ID: UUID of the Proxmox node registered in the control plane\n'
  printf '#   Run: pnpm --filter @ninja/control-plane db:query "SELECT id, name FROM nodes"\n'
  printf 'NODE_ID=\n'
  printf '\n'
  printf '# VMID: Container ID on that Proxmox node (e.g. 100, 101, ...)\n'
  printf 'VMID=\n'
  printf '\n'
  printf '# ── Control plane ───────────────────────────────────────────\n'
  printf 'CONTROL_PLANE_URL=http://localhost:%s\n' "$PORT"
  printf '\n'
  printf '# ── Shared secret (must match control-plane AGENT_SECRET) ───\n'
  printf 'AGENT_SECRET=%s\n' "$AGENT_SECRET"
  printf '\n'
  printf '# ── Optional overrides ──────────────────────────────────────\n'
  printf '# HOSTNAME=           # defaults to os.hostname()\n'
  printf '# HEARTBEAT_INTERVAL_MS=10000\n'
  printf '# RECONNECT_DELAY_MS=5000\n'
  printf '# LOG_LEVEL=info\n'
} > "$AGENT_ENV_FILE"

log_ok "Written to env/deploy-agent.env"
log_warn "Fill in NODE_ID and VMID in env/deploy-agent.env before running the agent."

# Export collected values so child processes (migrate, seed) can read them
# without needing a dotenv loader — migrate.ts reads process.env directly.
export DATABASE_URL REDIS_URL JWT_SECRET ENCRYPTION_KEY \
       AGENT_SECRET GITHUB_WEBHOOK_SECRET CORS_ORIGIN

printf '\n'

# ─────────────────────────────────────────────────────────────────────────────
#  7. OPTIONAL STEPS
# ─────────────────────────────────────────────────────────────────────────────

# Docker compose
if [ "$OPT_SKIP_DOCKER" -eq 0 ]; then
  if [ -f "$COMPOSE_FILE" ]; then
    run_step "Start Docker services" _step_docker

    # Wait for Postgres to accept connections before proceeding
    log_info "Waiting for Postgres to be ready..."
    _pg_attempts=0
    _pg_max=30
    while [ "$_pg_attempts" -lt "$_pg_max" ]; do
      if docker compose -f "$COMPOSE_FILE" exec -T postgres \
           pg_isready -U ninja -d ninja_ops -q 2>/dev/null; then
        log_ok "Postgres is ready"
        break
      fi
      _pg_attempts=$((_pg_attempts + 1))
      if [ "$_pg_attempts" -eq "$_pg_max" ]; then
        die "Postgres did not become ready after ${_pg_max}s. Check: docker compose -f docker/docker-compose.yml logs postgres"
      fi
      sleep 1
    done
  else
    log_warn "docker/docker-compose.yml not found — skipping."
    log_warn "Start Postgres and Redis manually before launching the app."
  fi
else
  log_info "Skipping Docker services (--skip-docker)"
fi

# pnpm install
if [ "$OPT_SKIP_INSTALL" -eq 0 ]; then
  run_step "Install dependencies" _step_install
else
  log_info "Skipping pnpm install (--skip-install)"
fi

# Package agent bundles (requires install to have run first)
run_step "Build deploy-agent bundle" _step_package_agent
run_step "Build log-agent bundle"    _step_package_log_agent

# Migrations and seed (run seed only if migrate succeeds)
if [ "$OPT_SKIP_MIGRATE" -eq 0 ]; then
  if run_step "Run database migrations" _step_migrate; then
    run_step "Seed database" _step_seed
  fi
else
  log_info "Skipping db:migrate and db:seed (--skip-migrate)"
fi

# ─────────────────────────────────────────────────────────────────────────────
#  8. FINAL SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
printf '\n'
log_ok "Done. Run ${C_BLD}pnpm dev${C_RST} to start the development server."
log_info "API will be available at http://localhost:${PORT}"
log_info "Docs at http://localhost:${PORT}/api/docs"
log_info "Agent .env written — set NODE_ID and VMID in env/deploy-agent.env before running the agent."

# ── External IP detection ─────────────────────────────────────────────────────
# Collect non-loopback, non-link-local IPv4 addresses via `ip` or `ifconfig`
_ext_ips=''

if command -v ip >/dev/null 2>&1; then
  # Parse `ip -4 addr show` output; extract lines with "inet ", skip 127. and 169.254.
  _ext_ips=$(ip -4 addr show 2>/dev/null \
    | grep 'inet ' \
    | awk '{print $2}' \
    | sed 's|/.*||' \
    | grep -v '^127\.' \
    | grep -v '^169\.254\.')
elif command -v ifconfig >/dev/null 2>&1; then
  # Fallback: parse `ifconfig` output for inet lines
  _ext_ips=$(ifconfig 2>/dev/null \
    | grep 'inet ' \
    | awk '{print $2}' \
    | sed 's/addr://' \
    | grep -v '^127\.' \
    | grep -v '^169\.254\.')
fi
# else: neither tool available — skip silently

if [ -n "$_ext_ips" ]; then
  log_info "Also reachable at:"
  printf '%s\n' "$_ext_ips" | while IFS= read -r _ip; do
    [ -z "$_ip" ] && continue
    log_info "  http://${_ip}:${PORT}      (local network)"
    log_info "  http://${_ip}:${PORT}/api/docs"
  done
fi

printf '\n'
