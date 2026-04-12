# ninja-ops LXC Deployment

Provisions four Debian 12 LXC containers on a Proxmox VE host using `pct create` / `pct exec`. No Ansible, no external orchestration.

## Prerequisites

- Proxmox VE 8.x host
- `pct` and `pvesh` available (run scripts on the PVE host itself)
- `openssl` installed on the host (for secret generation)
- Internet access from the PVE host (templates + apt packages)
- A storage pool with enough capacity (see resource table below)

## Network Architecture

| Container | CT ID | Hostname | IP | Role |
|---|---|---|---|---|
| postgres-01 | 200 | postgres-01 | 10.0.0.10 | PostgreSQL 17 |
| redis-01 | 201 | redis-01 | 10.0.0.11 | Redis 7 |
| control-plane-01 | 202 | control-plane-01 | 10.0.0.20 | Fastify API |
| dashboard-01 | 203 | dashboard-01 | 10.0.0.21 | React + serve |

All containers are unprivileged, on bridge `vmbr0`, gateway `10.0.0.1`.

## Resource Requirements

| Container | Disk | RAM | Swap | Cores |
|---|---|---|---|---|
| postgres-01 | 8 GB | 1 GB | 512 MB | 2 |
| redis-01 | 4 GB | 512 MB | 256 MB | 1 |
| control-plane-01 | 8 GB | 2 GB | 512 MB | 2 |
| dashboard-01 | 4 GB | 512 MB | 256 MB | 1 |
| **Total** | **24 GB** | **4 GB** | **1.5 GB** | **6** |

## Quick Start

Run these in order on your Proxmox VE host. Each step must complete before the next.

### 1. PostgreSQL

```bash
bash infrastructure/scripts/setup-postgres.sh
# Note the connection URL from the output
```

With custom password:
```bash
PG_PASSWORD=mysecret bash infrastructure/scripts/setup-postgres.sh --yes
```

### 2. Redis

```bash
bash infrastructure/scripts/setup-redis.sh
# Note the connection URL from the output
```

With auth:
```bash
REDIS_PASSWORD=mysecret bash infrastructure/scripts/setup-redis.sh --yes
```

### 3. Control Plane

```bash
DATABASE_URL="postgres://ninja:PW@10.0.0.10:5432/ninja_ops" \
REDIS_URL="redis://10.0.0.11:6379" \
bash infrastructure/scripts/setup-control-plane.sh
# Note the admin credentials and secrets from the output
```

Unattended with all options:
```bash
DATABASE_URL="postgres://ninja:PW@10.0.0.10:5432/ninja_ops" \
REDIS_URL="redis://10.0.0.11:6379" \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=mypassword \
bash infrastructure/scripts/setup-control-plane.sh --yes
```

### 4. Dashboard

Builds on CT 202 then transfers `dist/` — CT 202 must be running.

```bash
bash infrastructure/scripts/setup-dashboard.sh
```

With a custom API URL baked into the bundle:
```bash
VITE_API_URL=http://10.0.0.20:3000 \
bash infrastructure/scripts/setup-dashboard.sh --yes
```

---

## Curl-Pipe Usage

Each script is self-contained and can be downloaded and piped directly:

```bash
# PostgreSQL
curl -sSL https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main/infrastructure/scripts/setup-postgres.sh \
  | PG_PASSWORD=secret bash

# Redis
curl -sSL https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main/infrastructure/scripts/setup-redis.sh \
  | bash

# Control Plane (DATABASE_URL and REDIS_URL required)
curl -sSL https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main/infrastructure/scripts/setup-control-plane.sh \
  | DATABASE_URL="postgres://ninja:pw@10.0.0.10:5432/ninja_ops" \
    REDIS_URL="redis://10.0.0.11:6379" \
    bash

# Dashboard
curl -sSL https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main/infrastructure/scripts/setup-dashboard.sh \
  | bash
```

---

## Script Reference

### Common flags

| Flag | Effect |
|---|---|
| `--yes` / `-y` | Skip confirmation prompt |
| `--force` | Destroy and recreate container if it exists |
| `--help` / `-h` | Show usage |

### setup-postgres.sh

| Variable | Default | Description |
|---|---|---|
| `CT_ID` | `200` | Proxmox container ID |
| `CT_HOSTNAME` | `postgres-01` | Container hostname |
| `CT_STORAGE` | `local-lvm` | Storage pool |
| `CT_DISK` | `8` | Disk size (GB) |
| `CT_MEMORY` | `1024` | Memory (MB) |
| `CT_SWAP` | `512` | Swap (MB) |
| `CT_CORES` | `2` | CPU cores |
| `CT_TEMPLATE_STORAGE` | `local` | Template storage |
| `CT_TEMPLATE_DISTRO` | `debian-12` | Distro pattern |
| `NET_BRIDGE` | `vmbr0` | Network bridge |
| `NET_IP` | `10.0.0.10/24` | Container IP/CIDR |
| `NET_GW` | `10.0.0.1` | Gateway |
| `NET_DNS` | `1.1.1.1` | DNS server |
| `PG_VERSION` | `18` | PostgreSQL version |
| `PG_DB` | `ninja_ops` | Database name |
| `PG_USER` | `ninja` | Database user |
| `PG_PASSWORD` | *(auto-generated)* | Database password |
| `PG_ALLOWED_NETWORK` | `10.0.0.0/24` | pg_hba.conf network |
| `PG_MAX_CONNECTIONS` | `100` | max_connections |
| `PG_SHARED_BUFFERS` | `256MB` | shared_buffers |
| `TZ` | `Pacific/Auckland` | Timezone |

### setup-redis.sh

| Variable | Default | Description |
|---|---|---|
| `CT_ID` | `201` | Proxmox container ID |
| `CT_HOSTNAME` | `redis-01` | Container hostname |
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
| `CT_ID` | `202` | Proxmox container ID |
| `CT_HOSTNAME` | `control-plane-01` | Container hostname |
| `CT_DISK` | `8` | Disk size (GB) |
| `CT_MEMORY` | `2048` | Memory (MB) |
| `CT_CORES` | `2` | CPU cores |
| `NET_IP` | `10.0.0.20/24` | Container IP/CIDR |
| `NODE_VERSION` | `22` | Node.js version |
| `REPO_URL` | *(GitHub URL)* | Repository URL |
| `REPO_BRANCH` | `main` | Branch to clone |
| `GITHUB_TOKEN` | *(empty)* | Token for private repo |
| `INSTALL_DIR` | `/opt/ninja-ops` | Installation directory |
| `SERVICE_USER` | `ninja` | System service user |
| `JWT_SECRET` | *(auto-generated)* | 128-char hex JWT secret |
| `ENCRYPTION_KEY` | *(auto-generated)* | 64-char hex encryption key |
| `AGENT_SECRET` | *(auto-generated)* | 128-char hex agent secret |
| `GITHUB_WEBHOOK_SECRET` | *(auto-generated)* | GitHub webhook secret |
| `ADMIN_USERNAME` | `admin` | Admin user for seed |
| `ADMIN_PASSWORD` | *(auto-generated)* | Admin password for seed |
| `CP_PORT` | `3000` | API listen port |
| `CORS_ORIGIN` | `http://10.0.0.21` | Allowed CORS origin |
| `RUN_SEED` | `true` | Run database seed |
| `TZ` | `Pacific/Auckland` | Timezone |

### setup-dashboard.sh

| Variable | Default | Description |
|---|---|---|
| `CT_ID` | `203` | Proxmox container ID |
| `CT_HOSTNAME` | `dashboard-01` | Container hostname |
| `CT_DISK` | `4` | Disk size (GB) |
| `CT_MEMORY` | `512` | Memory (MB) |
| `CT_CORES` | `1` | CPU cores |
| `NET_IP` | `10.0.0.21/24` | Container IP/CIDR |
| `CT_CP_ID` | `202` | Control plane CT to build on |
| `CP_INSTALL_DIR` | `/opt/ninja-ops` | Repo path on the control plane CT |
| `CP_SERVICE_USER` | `ninja` | Service user on the control plane CT |
| `VITE_API_URL` | `http://10.0.0.20:3000` | Control plane URL baked into the bundle |
| `DASH_DIR` | `/opt/dashboard` | Directory to serve from |
| `SERVE_PORT` | `8080` | Port `serve` listens on |
| `SERVICE_USER` | `ninja` | System user in this container |
| `NODE_VERSION` | `22` | Node.js version |
| `TZ` | `Pacific/Auckland` | Timezone |

---

## Post-Deployment

After all four scripts complete:

1. Open the dashboard: `http://10.0.0.21:8080`
2. Log in with the admin credentials printed by `setup-control-plane.sh`
3. Verify the API: `curl http://10.0.0.20:3000/healthz`

### Change admin password

```bash
pct exec 202 -- bash -c "
  cd /opt/ninja-ops && \
  DATABASE_URL=\$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) \
  pnpm --filter @ninja/control-plane db:seed
"
```

Or update directly via the dashboard Settings page.

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

Build on the control plane, then rerun the setup script (CT 202 stays running throughout):

```bash
bash infrastructure/scripts/setup-dashboard.sh --yes --force
```

Or manually:

```bash
# 1. Build on CT 202
pct exec 202 -- bash -c "
  cd /opt/ninja-ops && \
  sudo -u ninja git pull && \
  sudo -u ninja pnpm install --frozen-lockfile && \
  sudo -u ninja pnpm --filter @ninja/types build && \
  VITE_API_URL=http://10.0.0.20:3000 sudo -u ninja pnpm --filter @ninja/dashboard build && \
  tar -czf /tmp/ninja-dashboard.tar.gz -C /opt/ninja-ops/apps/dashboard dist
"

# 2. Transfer and deploy to CT 203
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

### View service logs

```bash
# Control plane
pct exec 202 -- journalctl -u ninja-control-plane -f

# Dashboard (serve)
pct exec 203 -- journalctl -u ninja-dashboard -f

# PostgreSQL
pct exec 200 -- journalctl -u postgresql -f

# Redis
pct exec 201 -- journalctl -u redis-server -f
```

### Live debugging inside a container

```bash
pct exec 202 -- bash          # open a shell
pct exec 202 -- bash -c "..."  # run a command
```

### Check network connectivity

```bash
# From control plane, test database
pct exec 202 -- bash -c "
  DATABASE_URL=\$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-)
  psql \$DATABASE_URL -c 'SELECT 1'
"

# From control plane, test Redis
pct exec 202 -- redis-cli -h 10.0.0.11 ping

# From host, test control plane health
curl http://10.0.0.20:3000/healthz

# From host, test dashboard
curl -I http://10.0.0.21
```

### Container won't start

```bash
pct status 202          # check state
pct start 202           # start if stopped
pct exec 202 -- ps aux  # check processes
```

---

## Security Notes

- All containers are **unprivileged** with `nesting=1` (required for Node.js)
- The env file `/etc/ninja-ops/control-plane.env` is `chmod 0600`, owned by `ninja`
- Redis binds to `0.0.0.0` — it is protected by LXC network isolation, not by Redis auth alone. Set `REDIS_PASSWORD` for defence-in-depth.
- PostgreSQL uses `scram-sha-256` authentication and only accepts connections from `10.0.0.0/24`
- Caddy serves only the pre-built static bundle; the Node.js process is not exposed externally
- The `ninja` service user has no sudo privileges at runtime (`NoNewPrivileges=true` in systemd unit)
