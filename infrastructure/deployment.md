# ninja-ops LXC Deployment

Provisions four Debian 12 LXC containers on a Proxmox VE host using `pct create` / `pct exec`. No Ansible, no external orchestration. The dashboard is built on the control plane container and transferred over — CT dashboard needs only Node.js to run `serve`.

## Prerequisites

- Proxmox VE 8.x host with `pct` and `pvesh` available
- `openssl` installed on the host (for secret generation)
- Internet access from the PVE host (templates + apt packages)
- Enough storage capacity (see defaults below — all sizes are configurable)

## Network Architecture

| Hostname | IP | Role |
|---|---|---|
| postgres-01 | 10.0.0.10 | PostgreSQL 18 |
| redis-01 | 10.0.0.11 | Redis |
| control-plane-01 | 10.0.0.20 | Fastify API (port 3000) |
| dashboard-01 | 10.0.0.21 | React + serve (port 8080) |

All IPs, ports, and hostnames are configurable via environment variables.

## Resource Defaults

These are the default values used when no overrides are set. All can be changed — see [Script Reference](#script-reference).

| Container | `CT_DISK` | `CT_MEMORY` | `CT_SWAP` | `CT_CORES` |
|---|---|---|---|---|
| postgres-01 | 8 GB | 1024 MB | 512 MB | 2 |
| redis-01 | 4 GB | 512 MB | 256 MB | 1 |
| control-plane-01 | 8 GB | 2048 MB | 512 MB | 2 |
| dashboard-01 | 4 GB | 512 MB | 256 MB | 1 |
| **Total** | **24 GB** | **4 GB** | **1.5 GB** | **6** |

---

## Quick Start

Nothing needs to be installed on the Proxmox host — all scripts are fetched directly from GitHub. Run this on the PVE host in order.

```bash
RAW="https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main"

# ── Prompt for user-defined values ────────────────────────────────────────────
printf '\033[0;36m[ninja]\033[0m Admin username [admin]: ' >/dev/tty; read -r ADMIN_USERNAME </dev/tty
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
printf '\033[0;36m[ninja]\033[0m Admin password [leave blank to auto-generate]: ' >/dev/tty; read -r -s ADMIN_PASSWORD </dev/tty; printf '\n' >/dev/tty
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -hex 12)}"

# ── Generate secrets ──────────────────────────────────────────────────────────
# Uses openssl rand -hex, the same output format as gen_hex in scripts/setup-env.sh
PG_PASSWORD=$(openssl rand -hex 16)
REDIS_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 64)
ENCRYPTION_KEY=$(openssl rand -hex 32)
AGENT_SECRET=$(openssl rand -hex 64)
GITHUB_WEBHOOK_SECRET=$(openssl rand -hex 32)

# ── Write deploy config ───────────────────────────────────────────────────────
cat > /tmp/ninja-deploy.env <<EOF
PG_PASSWORD=${PG_PASSWORD}
DATABASE_URL=postgres://ninja:${PG_PASSWORD}@10.0.0.10:5432/ninja_ops

REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@10.0.0.11:6379

ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
AGENT_SECRET=${AGENT_SECRET}
GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
EOF

printf '\n\033[0;33m── Save these to your password manager ──\033[0m\n\n'
cat /tmp/ninja-deploy.env
printf '\n\033[0;33m─────────────────────────────────────────\033[0m\n\n'
read -r -p "Press Enter once saved... " </dev/tty

# ── Deploy ────────────────────────────────────────────────────────────────────
set -a; source /tmp/ninja-deploy.env; set +a

bash <(curl -sSL "${RAW}/infrastructure/scripts/setup-postgres.sh")
bash <(curl -sSL "${RAW}/infrastructure/scripts/setup-redis.sh")
bash <(curl -sSL "${RAW}/infrastructure/scripts/setup-control-plane.sh")
bash <(curl -sSL "${RAW}/infrastructure/scripts/setup-dashboard.sh")

# ── Clean up ──────────────────────────────────────────────────────────────────
rm /tmp/ninja-deploy.env
```

All secrets are generated before any container is created. The env file is deleted from the host after deployment completes.

To override any default (IP, port, resources, etc.) add the variable to the env file before the `set -a` line — see [Script Reference](#script-reference).

---

## Script Reference

All scripts accept `--yes` (skip prompt), `--force` (destroy and recreate), and `--help`.

### setup-postgres.sh

| Variable | Default | Description |
|---|---|---|
| `CT_HOSTNAME` | `postgres-01` | Container hostname |
| `CT_STORAGE` | `local-lvm` | Storage pool |
| `CT_DISK` | `8` | Disk size (GB) |
| `CT_MEMORY` | `1024` | Memory (MB) |
| `CT_SWAP` | `512` | Swap (MB) |
| `CT_CORES` | `2` | CPU cores |
| `CT_TEMPLATE_DISTRO` | `debian-12` | Distro pattern for template lookup |
| `NET_BRIDGE` | `vmbr0` | Network bridge |
| `NET_IP` | `10.0.0.10/24` | Container IP/CIDR |
| `NET_GW` | `10.0.0.1` | Gateway |
| `NET_DNS` | `1.1.1.1` | DNS server |
| `PG_VERSION` | `18` | PostgreSQL version |
| `PG_DB` | `ninja_ops` | Database name |
| `PG_USER` | `ninja` | Database user |
| `PG_PASSWORD` | *(auto-generated)* | Database password |
| `PG_ALLOWED_NETWORK` | `10.0.0.0/24` | Network allowed in pg_hba.conf |
| `PG_MAX_CONNECTIONS` | `100` | max_connections |
| `PG_SHARED_BUFFERS` | `256MB` | shared_buffers |
| `TZ` | `Pacific/Auckland` | Timezone |

### setup-redis.sh

| Variable | Default | Description |
|---|---|---|
| `CT_HOSTNAME` | `redis-01` | Container hostname |
| `CT_STORAGE` | `local-lvm` | Storage pool |
| `CT_DISK` | `4` | Disk size (GB) |
| `CT_MEMORY` | `512` | Memory (MB) |
| `CT_SWAP` | `256` | Swap (MB) |
| `CT_CORES` | `1` | CPU cores |
| `NET_IP` | `10.0.0.11/24` | Container IP/CIDR |
| `REDIS_PASSWORD` | *(empty = no auth)* | Redis password |
| `REDIS_MAXMEMORY` | `256mb` | Max memory |
| `REDIS_MAXMEMORY_POLICY` | `noeviction` | Eviction policy |
| `TZ` | `Pacific/Auckland` | Timezone |

### setup-control-plane.sh

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | **required** | PostgreSQL connection string |
| `REDIS_URL` | **required** | Redis connection string |
| `CT_HOSTNAME` | `control-plane-01` | Container hostname |
| `CT_STORAGE` | `local-lvm` | Storage pool |
| `CT_DISK` | `8` | Disk size (GB) |
| `CT_MEMORY` | `2048` | Memory (MB) |
| `CT_SWAP` | `512` | Swap (MB) |
| `CT_CORES` | `2` | CPU cores |
| `NET_IP` | `10.0.0.20/24` | Container IP/CIDR |
| `CP_PORT` | `3000` | API listen port |
| `NODE_VERSION` | `22` | Node.js version |
| `REPO_URL` | *(GitHub URL)* | Repository to clone |
| `REPO_BRANCH` | `main` | Branch to clone |
| `GITHUB_TOKEN` | *(empty)* | Token for private repos |
| `INSTALL_DIR` | `/opt/ninja-ops` | Installation directory |
| `SERVICE_USER` | `ninja` | System service user |
| `JWT_SECRET` | *(auto-generated)* | 128-char hex JWT secret |
| `ENCRYPTION_KEY` | *(auto-generated)* | 64-char hex encryption key |
| `AGENT_SECRET` | *(auto-generated)* | 128-char hex agent secret |
| `GITHUB_WEBHOOK_SECRET` | *(auto-generated)* | GitHub webhook secret |
| `ADMIN_USERNAME` | `admin` | Seed admin username |
| `ADMIN_PASSWORD` | *(auto-generated)* | Seed admin password |
| `CORS_ORIGIN` | `http://10.0.0.21` | Allowed CORS origin |
| `RUN_SEED` | `true` | Run database seed |
| `TZ` | `Pacific/Auckland` | Timezone |

### setup-dashboard.sh

| Variable | Default | Description |
|---|---|---|
| `CT_HOSTNAME` | `dashboard-01` | Container hostname |
| `CT_STORAGE` | `local-lvm` | Storage pool |
| `CT_DISK` | `4` | Disk size (GB) |
| `CT_MEMORY` | `512` | Memory (MB) |
| `CT_SWAP` | `256` | Swap (MB) |
| `CT_CORES` | `1` | CPU cores |
| `NET_IP` | `10.0.0.21/24` | Container IP/CIDR |
| `CT_CP_ID` | `202` | Control plane CT to build on |
| `CP_INSTALL_DIR` | `/opt/ninja-ops` | Repo path on the control plane CT |
| `VITE_API_URL` | `http://10.0.0.20:3000` | Control plane URL baked into the bundle |
| `DASH_DIR` | `/opt/dashboard` | Directory to serve from |
| `SERVE_PORT` | `8080` | Port `serve` listens on |
| `NODE_VERSION` | `22` | Node.js version |
| `TZ` | `Pacific/Auckland` | Timezone |

---

## Updating

### Control Plane

```bash
pct exec 202 -- bash -c "
  cd /opt/ninja-ops && \
  sudo -u ninja git pull && \
  sudo -u ninja pnpm install --frozen-lockfile && \
  sudo -u ninja pnpm --filter @ninja/types build && \
  sudo -u ninja pnpm --filter @ninja/control-plane build && \
  sudo -u ninja pnpm package:agent && \
  sudo -u ninja pnpm package:log-agent && \
  sudo -E -u ninja DATABASE_URL=\$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) \
    pnpm --filter @ninja/control-plane db:migrate && \
  systemctl restart ninja-control-plane
"
```

### Dashboard

Build on CT 202, transfer to CT 203 — the control plane never restarts.

```bash
# Build on the control plane
pct exec 202 -- bash -c "
  cd /opt/ninja-ops && \
  sudo -u ninja git pull && \
  sudo -u ninja pnpm install --frozen-lockfile && \
  sudo -u ninja pnpm --filter @ninja/types build && \
  VITE_API_URL=http://10.0.0.20:3000 sudo -u ninja pnpm --filter @ninja/dashboard build && \
  tar -czf /tmp/ninja-dashboard.tar.gz -C /opt/ninja-ops/apps/dashboard dist
"

# Transfer and deploy
pct pull 202 /tmp/ninja-dashboard.tar.gz /tmp/ninja-dashboard.tar.gz
pct exec 202 -- rm /tmp/ninja-dashboard.tar.gz
pct push 203 /tmp/ninja-dashboard.tar.gz /tmp/ninja-dashboard.tar.gz
rm /tmp/ninja-dashboard.tar.gz
pct exec 203 -- bash -c "
  tar -xzf /tmp/ninja-dashboard.tar.gz -C /opt/dashboard && \
  chown -R ninja:ninja /opt/dashboard && \
  rm /tmp/ninja-dashboard.tar.gz && \
  systemctl restart ninja-dashboard
"
```

---

## Troubleshooting

```bash
# Service logs
pct exec 202 -- journalctl -u ninja-control-plane -f
pct exec 203 -- journalctl -u ninja-dashboard -f
pct exec 200 -- journalctl -u postgresql -f
pct exec 201 -- journalctl -u redis-server -f

# Open a shell
pct exec 202 -- bash

# Test database from control plane
pct exec 202 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) -c 'SELECT 1'
"

# Test Redis from control plane
pct exec 202 -- redis-cli -h 10.0.0.11 ping

# Health checks from host
curl http://10.0.0.20:3000/healthz
curl -I http://10.0.0.21:8080
```

---

## Security Notes

- All containers are unprivileged with `nesting=1` (required for Node.js)
- The env file `/etc/ninja-ops/control-plane.env` is `chmod 0600`, owned by `ninja`
- Redis binds to `0.0.0.0` — protected by LXC network isolation; set `REDIS_PASSWORD` for defence-in-depth
- PostgreSQL uses `scram-sha-256` and only accepts connections from `PG_ALLOWED_NETWORK`
- The `ninja` service user has no sudo privileges at runtime (`NoNewPrivileges=true` in systemd units)
