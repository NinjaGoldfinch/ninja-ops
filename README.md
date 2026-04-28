# ninja-ops

Self-hosted Proxmox management and deployment platform. Manage VMs and LXC containers, trigger deployments from GitHub Actions, and stream real-time metrics — all from a single control plane.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Package manager | pnpm 10 + Turborepo |
| Language | TypeScript (strict, ESM) |
| Validation | Zod 3 |
| API | Fastify 5 (REST + WebSocket) |
| Database | PostgreSQL 18 (postgres.js) |
| Cache / queues | Redis 7 + BullMQ |
| Frontend | React 19, Vite 5, TanStack Router/Query, Zustand, Tailwind CSS v4 |
| Testing | Vitest |

## Monorepo structure

```
ninja-ops/
├── apps/
│   ├── control-plane/      # Fastify REST + WebSocket API
│   ├── dashboard/          # React 19 + Vite frontend (port 5173)
│   ├── deploy-agent/       # Agent that runs on each managed container
│   ├── forge-cli/          # CLI tool (planned)
│   └── log-service/        # Log aggregation service (planned)
├── packages/
│   └── types/              # Shared Zod schemas and TypeScript types
├── infrastructure/
│   └── scripts/            # LXC provisioning scripts
├── scripts/
│   └── setup-env.sh        # First-time local dev setup
└── docker/
    └── docker-compose.yml  # Local dev: Postgres + Redis
```

---

## Local development

### Quick start

```bash
# Automated (recommended) — checks prereqs, generates secrets, starts Docker, migrates, seeds
./scripts/setup-env.sh
pnpm dev
```

### Manual setup

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d
cp apps/control-plane/.env.example apps/control-plane/.env
# Edit .env — see docs/setup.md for secret generation commands
pnpm --filter @ninja/control-plane db:migrate
pnpm --filter @ninja/control-plane db:seed
pnpm dev
```

| Service | URL |
|---|---|
| Dashboard | `http://localhost:5173` |
| Control plane API | `http://localhost:3000` |
| API docs (Scalar) | `http://localhost:3000/api/docs` |

Default login: **admin** / **changeme123!**

> `pnpm dev` uses Turborepo's TUI. Press `1`/`2` to switch between service panes.

### Workspace commands

| Command | Description |
|---|---|
| `pnpm dev` | Start all services with hot reload |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm lint:fix` | Lint and auto-fix |

---

## Production deployment

Provisions five Debian 13 LXC containers on a Proxmox VE host using `pct create` / `pct exec`. No Ansible, no external orchestration. The dashboard is built on the control plane container and transferred over.

### Network architecture

| Hostname | IP | Role |
|---|---|---|
| postgres-01 | 10.0.0.10 | PostgreSQL 18 |
| redis-01 | 10.0.0.11 | Redis 7 |
| control-plane-01 | 10.0.0.20 | Fastify API (port 3000) |
| dashboard-01 | 10.0.0.21 | React + serve (port 8080) |
| nginx-01 | 10.0.0.22 | Nginx reverse proxy (port 80) |

All IPs, ports, and hostnames are configurable via environment variables.

### Resource defaults

| Container | Disk | Memory | Swap | Cores |
|---|---|---|---|---|
| postgres-01 | 8 GB | 1024 MB | 512 MB | 2 |
| redis-01 | 4 GB | 512 MB | 256 MB | 1 |
| control-plane-01 | 8 GB | 2048 MB | 512 MB | 2 |
| dashboard-01 | 4 GB | 512 MB | 256 MB | 1 |
| nginx-01 | 2 GB | 256 MB | 128 MB | 1 |
| **Total** | **26 GB** | **4.25 GB** | **1.625 GB** | **7** |

### Prerequisites

- Proxmox VE 8.x host with `pct` and `pvesh` available
- `openssl` installed on the host (for secret generation)
- Internet access from the PVE host (templates + apt packages)

### Quick start

All scripts run on the **Proxmox host** as root. Nothing needs to be pre-installed.

**1. Configure**

```bash
RAW="https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main"
curl -sSL "${RAW}/infrastructure/scripts/setup-env.sh" -o setup-env.sh
bash setup-env.sh
```

Review the generated `ninja-ops.env`, save the secrets to a password manager, then source it:

```bash
set -a; source ninja-ops.env; set +a
```

**2. PostgreSQL**

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-postgres.sh" -o setup-postgres.sh
bash setup-postgres.sh
```

**3. Redis**

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-redis.sh" -o setup-redis.sh
bash setup-redis.sh
```

**4. Control plane**

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-control-plane.sh" -o setup-control-plane.sh
bash setup-control-plane.sh
```

**5. Dashboard**

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-dashboard.sh" -o setup-dashboard.sh
bash setup-dashboard.sh
```

**6. Nginx**

```bash
curl -sSL "${RAW}/infrastructure/scripts/setup-nginx.sh" -o setup-nginx.sh
bash setup-nginx.sh
```

Each script shows a confirmation summary before provisioning. Pass `--yes` to skip it, `--force` to destroy and recreate an existing container.

All scripts accept `--env <file>` to load a `ninja-ops.env` file directly, and auto-detect `ninja-ops.env` in the current directory if the flag is omitted. Shell environment variables always take priority over values in the file.

To re-run a single step later:

```bash
bash setup-control-plane.sh --env ninja-ops.env --force
```

Or source the env file manually if you prefer the old approach:

```bash
set -a; source ninja-ops.env; set +a
bash setup-control-plane.sh --force
```

### Script variables

All scripts accept `--yes` (skip prompt), `--force` (destroy and recreate), and `--help`.

**setup-postgres.sh**

| Variable | Default | Description |
|---|---|---|
| `CT_HOSTNAME` | `postgres-01` | Container hostname |
| `CT_STORAGE` | `local-lvm` | Storage pool |
| `CT_DISK` | `8` | Disk size (GB) |
| `CT_MEMORY` | `1024` | Memory (MB) |
| `CT_SWAP` | `512` | Swap (MB) |
| `CT_CORES` | `2` | CPU cores |
| `CT_TEMPLATE_DISTRO` | `debian-12-standard` | Distro pattern for template lookup |
| `NET_BRIDGE` | `vmbr0` | Network bridge |
| `NET_IP` | `10.0.0.10/24` | Container IP/CIDR |
| `NET_GW` | `10.0.0.1` | Gateway |
| `NET_DNS` | `1.1.1.1` | DNS server |
| `PG_VERSION` | `18` | PostgreSQL version |
| `PG_DB` | `ninja_ops` | Database name |
| `PG_USER` | `ninja` | Database user |
| `PG_PASSWORD` | *(auto-generated)* | Database password |
| `PG_ALLOWED_NETWORK` | `10.0.0.0/24` | Network allowed in pg_hba.conf |
| `TZ` | `Pacific/Auckland` | Timezone |

**setup-redis.sh**

| Variable | Default | Description |
|---|---|---|
| `CT_HOSTNAME` | `redis-01` | Container hostname |
| `NET_IP` | `10.0.0.11/24` | Container IP/CIDR |
| `REDIS_PASSWORD` | *(empty = no auth)* | Redis password |
| `REDIS_MAXMEMORY` | `256mb` | Max memory |
| `REDIS_MAXMEMORY_POLICY` | `noeviction` | Eviction policy |

**setup-control-plane.sh**

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | **required** | PostgreSQL connection string |
| `REDIS_URL` | **required** | Redis connection string |
| `CT_HOSTNAME` | `control-plane-01` | Container hostname |
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
| `RUN_SEED` | `true` | Run database seed on first provision |
| `TZ` | `Pacific/Auckland` | Timezone |

**setup-dashboard.sh**

| Variable | Default | Description |
|---|---|---|
| `CT_HOSTNAME` | `dashboard-01` | Container hostname |
| `NET_IP` | `10.0.0.21/24` | Container IP/CIDR |
| `CT_CP_ID` | `102` | Control plane CT to build on |
| `CP_INSTALL_DIR` | `/opt/ninja-ops` | Repo path on the control plane CT |
| `VITE_API_URL` | *(empty — behind nginx)* | Control plane URL baked into the bundle |
| `DASH_DIR` | `/opt/dashboard` | Directory to serve from |
| `SERVE_PORT` | `8080` | Port `serve` listens on |

**setup-nginx.sh**

| Variable | Default | Description |
|---|---|---|
| `NGINX_HOSTNAME` | `nginx-01` | Container hostname |
| `NGINX_NET_IP` | `10.0.0.22/24` | Container IP/CIDR |
| `NGINX_DOMAIN` | `_` | nginx `server_name` (use real domain for TLS later) |
| `CP_IP` | `10.0.0.20` | Control-plane IP |
| `CP_PORT` | `3000` | Control-plane port |
| `DASH_IP` | `10.0.0.21` | Dashboard IP |
| `DASH_PORT` | `8080` | Dashboard port |

### Updating

**Control plane**

Uses `git fetch + reset --hard` to avoid merge conflicts with locally generated build artifacts.

```bash
pct exec 102 -- bash -c "
  cd /opt/ninja-ops && \
  sudo -u ninja git fetch origin && \
  sudo -u ninja git reset --hard origin/main && \
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

**Dashboard**

Build on CT 102, transfer to CT 103 — the control plane never restarts.

```bash
# Build on the control plane (VITE_API_URL empty = same-origin via nginx)
pct exec 102 -- bash -c "
  cd /opt/ninja-ops && \
  sudo -u ninja git fetch origin && \
  sudo -u ninja git reset --hard origin/main && \
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

**Nginx config**

```bash
RAW="https://raw.githubusercontent.com/NinjaGoldfinch/ninja-ops/main"
pct exec 104 -- bash -c "
  curl -sSfL '${RAW}/infrastructure/nginx/ninja-ops.conf' \
    -o /etc/nginx/sites-available/ninja-ops.conf && \
  nginx -t && systemctl reload nginx
"
```

### Exposing nginx publicly

Run on the **Proxmox host** to forward port 80 from your LAN IP to the nginx container. The script auto-detects the interface and is idempotent.

```bash
PUBLIC_IFACE=$(ip route show default | awk '{print $5; exit}')
PUBLIC_IP=$(ip -4 addr show "$PUBLIC_IFACE" | awk '/inet / {print $2; exit}' | cut -d/ -f1)

# Remove any existing rules (idempotent)
iptables-save | grep -- '--dport 80 -j DNAT --to-destination 10.0.0.22:80' \
  | sed 's/^-A/-D/' | while IFS= read -r rule; do iptables -t nat $rule 2>/dev/null || true; done
iptables -D FORWARD -p tcp -d 10.0.0.22 --dport 80 \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
iptables -t nat -D POSTROUTING -s 10.0.0.0/24 -o "$PUBLIC_IFACE" -j MASQUERADE 2>/dev/null || true

# Add rules
iptables -t nat -A PREROUTING -d "$PUBLIC_IP" -p tcp --dport 80 -j DNAT --to-destination 10.0.0.22:80
iptables -A FORWARD -p tcp -d 10.0.0.22 --dport 80 -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -t nat -A POSTROUTING -s 10.0.0.0/24 -o "$PUBLIC_IFACE" -j MASQUERADE

apt-get install -y iptables-persistent
netfilter-persistent save

echo "Done. Verify with: curl -I http://${PUBLIC_IP}/healthz"
```

> **TLS:** Forward port 443 the same way and run certbot inside CT 104. Change `server_name _` to your domain and add `listen 443 ssl` alongside `listen 80`.

---

## Debugging

All `pct exec` commands must run on the **Proxmox host**. If you are already inside a container, use the inner commands directly.

### Service logs (journalctl)

**Tail live logs**

```bash
# From Proxmox host
pct exec 102 -- journalctl -u ninja-control-plane -f
pct exec 103 -- journalctl -u ninja-dashboard -f
pct exec 100 -- journalctl -u postgresql -f
pct exec 101 -- journalctl -u redis-server -f
pct exec 104 -- journalctl -u nginx -f

# From inside the container
journalctl -u ninja-control-plane -f
```

**Last N lines**

```bash
pct exec 102 -- journalctl -u ninja-control-plane -n 100 --no-pager
```

**Since last boot**

```bash
pct exec 102 -- journalctl -u ninja-control-plane -b
```

**Filter by time**

```bash
pct exec 102 -- journalctl -u ninja-control-plane \
  --since "2025-01-15 10:00" --until "2025-01-15 11:00"
```

**Search for errors**

```bash
pct exec 102 -- journalctl -u ninja-control-plane -p err -b --no-pager
```

**Show structured JSON logs** (control plane uses pino)

```bash
pct exec 102 -- journalctl -u ninja-control-plane -f -o cat | head -20
```

### Service status

```bash
# Check running state and recent log tail
pct exec 102 -- systemctl status ninja-control-plane
pct exec 103 -- systemctl status ninja-dashboard
pct exec 104 -- systemctl status nginx

# Restart a service
pct exec 102 -- systemctl restart ninja-control-plane
pct exec 103 -- systemctl restart ninja-dashboard
pct exec 104 -- systemctl reload nginx   # reload config without downtime
```

### Health checks

```bash
# Control plane
curl http://10.0.0.20:3000/healthz
# → {"ok":true}

# Through nginx (confirms proxy is working)
curl http://10.0.0.22/healthz
# → {"ok":true}

# Dashboard static server
curl -I http://10.0.0.21:8080
# → HTTP/1.1 200 OK

# Login and get a token
curl -s -X POST http://10.0.0.20:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password>"}' | jq .
```

### Open a shell in a container

```bash
pct exec 100 -- bash   # postgres-01
pct exec 101 -- bash   # redis-01
pct exec 102 -- bash   # control-plane-01
pct exec 103 -- bash   # dashboard-01
pct exec 104 -- bash   # nginx-01
```

### PostgreSQL

```bash
# Connect to the database
pct exec 102 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) -c 'SELECT 1'
"

# Or from inside postgres-01
pct exec 100 -- bash -c "psql -U ninja -d ninja_ops"

# Check active connections
pct exec 102 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) \
    -c 'SELECT pid, usename, application_name, state, query FROM pg_stat_activity;'
"

# Check migration state
pct exec 102 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) \
    -c 'SELECT * FROM _migrations ORDER BY applied_at;'
"

# PostgreSQL logs
pct exec 100 -- journalctl -u postgresql -n 50 --no-pager
```

### Redis

```bash
# Ping Redis from control-plane
pct exec 102 -- redis-cli -h 10.0.0.11 ping
# → PONG

# Monitor live commands (useful for debugging BullMQ queue activity)
pct exec 102 -- redis-cli -h 10.0.0.11 monitor

# List BullMQ queues and job counts
pct exec 102 -- redis-cli -h 10.0.0.11 keys "bull:*" | sort

# Check queue depth for the deploy queue
pct exec 102 -- redis-cli -h 10.0.0.11 llen "bull:deploy:wait"

# Redis logs
pct exec 101 -- journalctl -u redis-server -n 50 --no-pager
```

### Nginx

```bash
# Test config validity
pct exec 104 -- nginx -t

# Dump running config
pct exec 104 -- nginx -T

# Access and error logs
pct exec 104 -- tail -f /var/log/nginx/access.log
pct exec 104 -- tail -f /var/log/nginx/error.log

# Or via journalctl
pct exec 104 -- journalctl -u nginx -f
```

### Control plane environment

```bash
# View the environment file (contains all secrets)
pct exec 102 -- cat /etc/ninja-ops/control-plane.env

# Verify env vars the running process sees
pct exec 102 -- bash -c "
  cat /proc/\$(systemctl show -p MainPID ninja-control-plane | cut -d= -f2)/environ \
    | tr '\0' '\n' | grep -v SECRET | grep -v PASSWORD
"
```

### Deploy agent issues

**Agent not connecting**

```bash
# Check if an agent is registered in the database
pct exec 102 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) \
    -c 'SELECT id, hostname, status, last_seen_at FROM agents ORDER BY last_seen_at DESC;'
"

# View deploy-agent logs inside an LXC
pct exec <agent-ct-id> -- journalctl -u ninja-deploy-agent -f

# Check the agent binary exists and is executable
pct exec <agent-ct-id> -- ls -lh /opt/ninja-agent/
```

**Deploy job stuck or failed**

```bash
# Check recent deploy jobs
pct exec 102 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) \
    -c \"SELECT id, state, exit_code, started_at, finished_at FROM deploy_jobs
         ORDER BY queued_at DESC LIMIT 10;\"
"

# Fetch log lines for a specific job
pct exec 102 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) \
    -c \"SELECT seq, line FROM deploy_log_lines WHERE job_id = '<job-id>' ORDER BY seq;\"
"
```

### Changing log verbosity

The control plane reads `LOG_LEVEL` from `/etc/ninja-ops/control-plane.env`. Valid values: `trace`, `debug`, `info`, `warn`, `error`.

```bash
# Temporarily increase to debug (reverts on restart unless you edit the file)
pct exec 102 -- bash -c "
  LOG_LEVEL=debug systemctl restart ninja-control-plane
"

# Permanently change
pct exec 102 -- sed -i 's/^LOG_LEVEL=.*/LOG_LEVEL=debug/' /etc/ninja-ops/control-plane.env
pct exec 102 -- systemctl restart ninja-control-plane
```

### Common failures

**Control plane won't start — `Invalid environment configuration`**

The control plane validates all env vars at startup via Zod. Check the journal for which variable failed:

```bash
pct exec 102 -- journalctl -u ninja-control-plane -n 30 --no-pager
```

`ENCRYPTION_KEY` must be exactly 64 hex characters. `DATABASE_URL` must start with `postgres://`.

**Control plane won't start — can't connect to PostgreSQL or Redis**

```bash
# Test connectivity from the control-plane container
pct exec 102 -- redis-cli -h 10.0.0.11 ping
pct exec 102 -- bash -c "
  psql \$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) -c 'SELECT 1'
"
```

Verify `postgres-01` and `redis-01` are running: `pct status 100` / `pct status 101`.

**`git pull` fails during update — local changes would be overwritten**

The update commands use `git fetch + reset --hard` specifically to avoid this. If you see a merge error, ensure you are running the update commands from the [Updating](#updating) section above, not a plain `git pull`.

**Nginx 502 Bad Gateway**

The control plane is down or not listening on its configured port.

```bash
pct exec 102 -- systemctl status ninja-control-plane
pct exec 102 -- curl -sf http://localhost:3000/healthz
```

**Nginx returns the dashboard for `/api/` routes**

Nginx config is stale. Run the [nginx config update command](#nginx-config) and check `nginx -t`.

**Agent connects then immediately disconnects**

The `AGENT_SECRET` in the agent's environment must match the control plane's `AGENT_SECRET`. Re-provision the agent with the correct secret.

**Migrations fail — `relation does not exist`**

Migrations run in filename order. If a newer migration references a table from an older one that wasn't applied, run all pending migrations:

```bash
pct exec 102 -- bash -c "
  cd /opt/ninja-ops && \
  DATABASE_URL=\$(grep DATABASE_URL /etc/ninja-ops/control-plane.env | cut -d= -f2-) \
  sudo -E -u ninja pnpm --filter @ninja/control-plane db:migrate
"
```

---

## Security notes

- All containers are unprivileged with `nesting=1` (required for Node.js)
- `/etc/ninja-ops/control-plane.env` is `chmod 0600`, owned by `ninja`
- Redis binds to `0.0.0.0` — protected by LXC network isolation; set `REDIS_PASSWORD` for defence-in-depth
- PostgreSQL uses `scram-sha-256` and only accepts connections from `PG_ALLOWED_NETWORK`
- The `ninja` service user has no sudo privileges at runtime (`NoNewPrivileges=true` in systemd units)
- End users connect to nginx only (`10.0.0.22:80`). Control plane and dashboard are not directly exposed

---

## Documentation

- [Local setup guide](docs/setup.md) — detailed local dev setup, env var reference, troubleshooting
- [Architecture](docs/architecture.md) — system design, data flows, API inventory, WebSocket protocol
