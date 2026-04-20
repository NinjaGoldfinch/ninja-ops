# ninja-ops LXC Deployment

Provisions five Debian 13 LXC containers on a Proxmox VE host using `pct create` / `pct exec`. No Ansible, no external orchestration. The dashboard is built on the control plane container and transferred over — CT dashboard needs only Node.js to run `serve`. An nginx reverse proxy provides a single entry point for browsers.

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
| nginx-01 | 10.0.0.22 | Nginx reverse proxy (port 80) |

All IPs, ports, and hostnames are configurable via environment variables.

## Resource Defaults

These are the default values used when no overrides are set. All can be changed via `setup-env.sh` or by editing `ninja-ops.env` before sourcing it.

| Container | `CT_DISK` | `CT_MEMORY` | `CT_SWAP` | `CT_CORES` |
|---|---|---|---|---|
| postgres-01 | 8 GB | 1024 MB | 512 MB | 2 |
| redis-01 | 4 GB | 512 MB | 256 MB | 1 |
| control-plane-01 | 8 GB | 2048 MB | 512 MB | 2 |
| dashboard-01 | 4 GB | 512 MB | 256 MB | 1 |
| nginx-01 | 2 GB | 256 MB | 128 MB | 1 |
| **Total** | **26 GB** | **4.25 GB** | **1.625 GB** | **7** |

---

## Quick Start

Nothing needs to be installed on the Proxmox host — all scripts are fetched directly from GitHub. Run everything on the PVE host as root.

### 1. Configure

Download and run the configuration wizard. It walks through settings for all four containers and writes them to `ninja-ops.env`.

```bash
RAW="https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main"
curl -sSL "${RAW}/infrastructure/scripts/setup-env.sh" -o setup-env.sh
bash setup-env.sh
```

Review the generated `ninja-ops.env`, save the secrets to a password manager, then source it:

```bash
set -a; source ninja-ops.env; set +a
```

### 2. PostgreSQL

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-postgres.sh" -o setup-postgres.sh
bash setup-postgres.sh
```

### 3. Redis

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-redis.sh" -o setup-redis.sh
bash setup-redis.sh
```

### 4. Control Plane

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-control-plane.sh" -o setup-control-plane.sh
bash setup-control-plane.sh
```

### 5. Dashboard

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-dashboard.sh" -o setup-dashboard.sh
bash setup-dashboard.sh
```

### 6. Nginx

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-nginx.sh" -o setup-nginx.sh
bash setup-nginx.sh
```

---

Each script shows a confirmation summary before provisioning. Pass `--yes` to skip it, `--force` to destroy and recreate an existing container.

To re-run a single step later, just re-source the env file and run that script:

```bash
set -a; source ninja-ops.env; set +a
bash setup-control-plane.sh --force
```

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
| `CT_CP_ID` | `102` | Control plane CT to build on |
| `CP_INSTALL_DIR` | `/opt/ninja-ops` | Repo path on the control plane CT |
| `VITE_API_URL` | *(empty — behind nginx)* | Control plane URL baked into the bundle |
| `DASH_DIR` | `/opt/dashboard` | Directory to serve from |
| `SERVE_PORT` | `8080` | Port `serve` listens on |
| `NODE_VERSION` | `22` | Node.js version |
| `TZ` | `Pacific/Auckland` | Timezone |

### setup-nginx.sh

| Variable | Default | Description |
|---|---|---|
| `NGINX_CT_ID` | `104` | Container ID |
| `NGINX_HOSTNAME` | `nginx-01` | Container hostname |
| `NGINX_STORAGE` | `local-lvm` | Storage pool |
| `NGINX_DISK` | `2` | Disk size (GB) |
| `NGINX_MEMORY` | `256` | Memory (MB) |
| `NGINX_SWAP` | `128` | Swap (MB) |
| `NGINX_CORES` | `1` | CPU cores |
| `NGINX_NET_IP` | `10.0.0.22/24` | Container IP/CIDR |
| `NGINX_NET_GW` | `10.0.0.1` | Gateway |
| `NGINX_NET_DNS` | `1.1.1.1` | DNS server |
| `NGINX_DOMAIN` | `_` | nginx `server_name` (use real domain for TLS later) |
| `CP_IP` | `10.0.0.20` | Control-plane IP |
| `CP_PORT` | `3000` | Control-plane port |
| `DASH_IP` | `10.0.0.21` | Dashboard IP |
| `DASH_PORT` | `8080` | Dashboard port |
| `TZ` | `Pacific/Auckland` | Timezone |

---

## Updating

### Control Plane

```bash
pct exec 102 -- bash -c "
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

Build on CT 102, transfer to CT 103 — the control plane never restarts.

```bash
# Build on the control plane (VITE_API_URL empty = same-origin via nginx)
pct exec 102 -- bash -c "
  cd /opt/ninja-ops && \
  sudo -u ninja git pull && \
  sudo -u ninja pnpm install --frozen-lockfile && \
  sudo -u ninja pnpm --filter @ninja/types build && \
  VITE_API_URL= sudo -u ninja pnpm --filter @ninja/dashboard build && \
  tar -czf /tmp/ninja-dashboard.tar.gz -C /opt/ninja-ops/apps/dashboard dist
"

# Transfer and deploy
pct pull 102 /tmp/ninja-dashboard.tar.gz /tmp/ninja-dashboard.tar.gz
pct exec 102 -- rm /tmp/ninja-dashboard.tar.gz
pct push 103 /tmp/ninja-dashboard.tar.gz /tmp/ninja-dashboard.tar.gz
rm /tmp/ninja-dashboard.tar.gz
pct exec 103 -- bash -c "
  tar -xzf /tmp/ninja-dashboard.tar.gz -C /opt/dashboard && \
  chown -R ninja:ninja /opt/dashboard && \
  rm /tmp/ninja-dashboard.tar.gz && \
  systemctl restart ninja-dashboard
"
```

### Nginx

Edit `infrastructure/nginx/ninja-ops.conf` in the repo, push, then pull it into the container:

```bash
RAW="https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main"
pct exec 104 -- bash -c "
  curl -sSfL '${RAW}/infrastructure/nginx/ninja-ops.conf' \
    -o /etc/nginx/sites-available/ninja-ops.conf && \
  nginx -t && systemctl reload nginx
"
```

---

## Exposing Nginx Publicly

Nginx sits on the private `10.0.0.22` network. Run this on the **Proxmox host** to forward port 80 from your LAN IP to the nginx container. The script auto-detects the interface and IP, and is idempotent — safe to re-run.

```bash
# Auto-detect the public-facing interface and its IP
PUBLIC_IFACE=$(ip route show default | awk '{print $5; exit}')
PUBLIC_IP=$(ip -4 addr show "$PUBLIC_IFACE" | awk '/inet / {print $2; exit}' | cut -d/ -f1)

echo "Interface : $PUBLIC_IFACE"
echo "IP        : $PUBLIC_IP"

# Remove any existing rules for this destination (idempotent)
iptables-save | grep -- '--dport 80 -j DNAT --to-destination 10.0.0.22:80' \
  | sed 's/^-A/-D/' | while IFS= read -r rule; do
    iptables -t nat $rule 2>/dev/null || true
  done
iptables -D FORWARD -p tcp -d 10.0.0.22 --dport 80 \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
iptables -t nat -D POSTROUTING -s 10.0.0.0/24 -o "$PUBLIC_IFACE" -j MASQUERADE 2>/dev/null || true

# Add rules
iptables -t nat -A PREROUTING -d "$PUBLIC_IP" -p tcp --dport 80 -j DNAT --to-destination 10.0.0.22:80
iptables -A FORWARD -p tcp -d 10.0.0.22 --dport 80 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -o "$PUBLIC_IFACE" -j MASQUERADE

# Persist across reboots
apt-get install -y iptables-persistent
netfilter-persistent save

echo "Done. Verify with: curl -I http://${PUBLIC_IP}/healthz"
```

To remove the rules:
```bash
PUBLIC_IFACE=$(ip route show default | awk '{print $5; exit}')
PUBLIC_IP=$(ip -4 addr show "$PUBLIC_IFACE" | awk '/inet / {print $2; exit}' | cut -d/ -f1)

iptables -t nat -D PREROUTING -d "$PUBLIC_IP" -p tcp --dport 80 -j DNAT --to-destination 10.0.0.22:80
iptables -D FORWARD -p tcp -d 10.0.0.22 --dport 80 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -t nat -D POSTROUTING -s 10.0.0.0/24 -o "$PUBLIC_IFACE" -j MASQUERADE
netfilter-persistent save
```

> **TLS:** When adding HTTPS later, forward port 443 the same way and run certbot inside CT 104. The nginx config's `server_name _` becomes your real domain, and `listen 443 ssl` is added alongside `listen 80`.

---

## Troubleshooting

```bash
# Service logs
pct exec 102 -- journalctl -u ninja-control-plane -f
pct exec 103 -- journalctl -u ninja-dashboard -f
pct exec 100 -- journalctl -u postgresql -f
pct exec 101 -- journalctl -u redis-server -f
pct exec 104 -- journalctl -u nginx -f
pct exec 104 -- tail -f /var/log/nginx/error.log

# Open a shell
pct exec 102 -- bash

# Test database from control plane
pct exec 102 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) -c 'SELECT 1'
"

# Test Redis from control plane
pct exec 102 -- redis-cli -h 10.0.0.11 ping

# Health checks from host
curl http://10.0.0.20:3000/healthz
curl -I http://10.0.0.21:8080
curl http://10.0.0.22/healthz
```

---

## Security Notes

- All containers are unprivileged with `nesting=1` (required for Node.js)
- The env file `/etc/ninja-ops/control-plane.env` is `chmod 0600`, owned by `ninja`
- Redis binds to `0.0.0.0` — protected by LXC network isolation; set `REDIS_PASSWORD` for defence-in-depth
- PostgreSQL uses `scram-sha-256` and only accepts connections from `PG_ALLOWED_NETWORK`
- The `ninja` service user has no sudo privileges at runtime (`NoNewPrivileges=true` in systemd units)
- End users connect to nginx only (10.0.0.22:80). The control-plane and dashboard are not directly exposed to browsers.
