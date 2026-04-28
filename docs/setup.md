# Local Development Setup

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | >= 22 | [nodejs.org](https://nodejs.org) or `nvm install 22` |
| pnpm | >= 10 | `npm install -g pnpm` |
| Docker | any recent | [docker.com](https://www.docker.com) |

## Automated setup (recommended)

Run the setup script from the repo root:

```bash
./scripts/setup-env.sh
```

The script will:
1. Verify Node.js 22+, pnpm, and Docker are installed and running
2. Auto-generate `JWT_SECRET`, `ENCRYPTION_KEY`, `AGENT_SECRET`, and `GITHUB_WEBHOOK_SECRET`
3. Prompt for `DATABASE_URL`, `REDIS_URL`, and `CORS_ORIGIN` (with sensible defaults)
4. Prompt for `SELF_DEPLOY_HOST` (auto-detected from local IP) and `SELF_DEPLOY_SSH_KEY` — offer to generate the key if absent
5. Prompt for `GITHUB_REPO` (auto-detected from `git remote`) and optional `GITHUB_TOKEN`
6. Display generated secrets in a bordered block so you can save them to a password manager
7. Write `env/control-plane.env` and `env/deploy-agent.env`
8. Start Docker services, run `pnpm install`, `db:migrate`, and `db:seed`

**Flags:**

| Flag | Effect |
|---|---|
| `--manual` | Prompt for every secret instead of auto-generating |
| `--skip-docker` | Do not start Docker services |
| `--skip-install` | Do not run `pnpm install` |
| `--skip-migrate` | Do not run `db:migrate` or `db:seed` |
| `--force` | Overwrite an existing `.env` without prompting |

Then start the dev server:

```bash
pnpm dev
```

---

## Manual step-by-step setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start dev infrastructure

```bash
docker compose -f docker/docker-compose.yml up -d
```

This starts:
- PostgreSQL 18 on `localhost:5432` (user: `ninja`, password: `ninja`, db: `ninja_ops`)
- Redis 7 on `localhost:6379`

### 3. Configure environment

```bash
cp apps/control-plane/.env.example apps/control-plane/.env
```

Open `apps/control-plane/.env` and fill in the required secrets (see [Environment variables](#environment-variables) below), or use `./scripts/setup-env.sh --skip-docker --skip-install --skip-migrate` to generate and write them automatically.

**Generate JWT_SECRET and AGENT_SECRET** (64 hex chars each):
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Generate ENCRYPTION_KEY** (32 bytes = 64 hex chars):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Generate GITHUB_WEBHOOK_SECRET** (any random string):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Run database migrations

```bash
pnpm --filter @ninja/control-plane db:migrate
```

This creates all tables in `ninja_ops`. Migrations are tracked in a `_migrations` table and run in order — safe to run multiple times.

### 5. Seed the admin user

```bash
pnpm --filter @ninja/control-plane db:seed
```

Creates an `admin` user with password `changeme123!`. Override with env vars:

```bash
ADMIN_USERNAME=yourname ADMIN_PASSWORD=yourpassword \
  pnpm --filter @ninja/control-plane db:seed
```

### 6. Start the dev server

```bash
pnpm dev
```

This starts all services via Turborepo's TUI — each service gets its own pane. Use the number keys (`1`, `2`, …) to switch between service logs.

To run services individually:

```bash
pnpm --filter @ninja/control-plane dev   # control plane only (port 3000)
pnpm --filter @ninja/dashboard dev       # dashboard only (port 5173)
```

### 7. Verify

| Service | URL |
|---|---|
| Dashboard | `http://localhost:5173` |
| Control plane | `http://localhost:3000` |
| API docs (Scalar) | `http://localhost:3000/api/docs` |

```bash
# Health check
curl http://localhost:3000/healthz
# → {"ok":true}

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme123!"}'
# → {"ok":true,"data":{"token":"...","user":{...}}}
```

Default dashboard credentials: **admin** / **changeme123!** (set by `db:seed`, overridable via env vars — see step 5).

---

## Dashboard scripts

Run from `apps/dashboard/` or with `pnpm --filter @ninja/dashboard <script>`:

| Script | Command | Description |
|---|---|---|
| `dev` | `vite` | Start with hot reload (port 5173) |
| `build` | `tsc && vite build` | Type-check then bundle to `dist/` |
| `preview` | `vite preview` | Preview production build |
| `typecheck` | `tsc --noEmit` | Type-check without emitting |
| `lint` | `eslint src` | Lint source |

---

## Control-plane scripts

Run from `apps/control-plane/` or with `pnpm --filter @ninja/control-plane <script>`:

| Script | Command | Description |
|---|---|---|
| `dev` | `tsx watch src/index.ts` | Start with hot reload |
| `build` | `tsc` | Compile to `dist/` |
| `start` | `node dist/index.js` | Run compiled output |
| `test` | `vitest run` | Run tests once |
| `test:watch` | `vitest` | Watch mode |
| `typecheck` | `tsc --noEmit` | Type-check without emitting |
| `lint` | `eslint src` | Lint source |
| `db:migrate` | `tsx scripts/migrate.ts` | Run pending migrations |
| `db:seed` | `tsx scripts/seed.ts` | Seed admin user |

---

## Environment variables

All variables for `apps/control-plane/.env`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP server port |
| `HOST` | No | `0.0.0.0` | HTTP server bind address |
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | No | `info` | `trace`, `debug`, `info`, `warn`, `error` |
| `DATABASE_URL` | **Yes** | — | Postgres connection string |
| `REDIS_URL` | **Yes** | — | Redis connection string |
| `JWT_SECRET` | **Yes** | — | At least 32 chars. Used to sign user JWTs |
| `JWT_EXPIRY` | No | `24h` | User token expiry (e.g. `1h`, `7d`) |
| `ENCRYPTION_KEY` | **Yes** | — | Exactly 64 hex chars (32 bytes). AES-256-GCM key for encrypting Proxmox token secrets at rest |
| `AGENT_SECRET` | **Yes** | — | Shared secret agents present when registering |
| `AGENT_JWT_EXPIRY` | No | `7d` | Agent token expiry |
| `GITHUB_WEBHOOK_SECRET` | **Yes** | — | GitHub webhook HMAC secret |
| `CORS_ORIGIN` | No | — | Comma-separated allowed origins. Empty = same-origin only |
| `RATE_LIMIT_MAX` | No | `100` | Max requests per window (global) |
| `RATE_LIMIT_WINDOW` | No | `60000` | Rate limit window in milliseconds |
| `SELF_DEPLOY_HOST` | No | — | IP/hostname of the machine running control-plane. Enables one-click redeploy from the `/services` dashboard page |
| `SELF_DEPLOY_SSH_KEY` | No | — | Path to an SSH private key the control-plane can use to SSH into `SELF_DEPLOY_HOST` |
| `SERVICE_CONTROL_PLANE_UNIT` | No | `ninja-control-plane` | systemd unit name for the control-plane service |
| `SERVICE_DASHBOARD_UNIT` | No | `nginx` | systemd unit name for the dashboard (nginx) service |
| `SERVICE_CONTROL_PLANE_DIR` | No | `/opt/ninja-ops` | Repo working directory on the deploy host for control-plane |
| `SERVICE_DASHBOARD_DIR` | No | `/opt/ninja-ops` | Repo working directory on the deploy host for the dashboard |
| `GITHUB_REPO` | No | — | `owner/repo` — enables the update-available badge in `/services` by polling GitHub Releases |
| `GITHUB_TOKEN` | No | — | GitHub personal access token. Optional; avoids the 60 req/hour unauthenticated rate limit |
| `SERVICE_VERSION_POLL_INTERVAL_MS` | No | `1800000` | How often (ms) to poll GitHub for new releases. Default: 30 minutes |

---

## Service self-redeployment

The `/services` dashboard page lets admins redeploy the control-plane and dashboard in one click. It SSHes into the host, runs `git reset --hard`, rebuilds, and restarts the systemd service.

### Required env vars

```
SELF_DEPLOY_HOST=10.0.0.20          # IP or hostname of the machine to SSH into
SELF_DEPLOY_SSH_KEY=/etc/ninja-ops/id_ed25519  # private key file (readable by the service user)
```

### Generate an SSH key (if you don't already have one)

```bash
ssh-keygen -t ed25519 -f /etc/ninja-ops/id_ed25519 -N "" -C "ninja-ops-self-deploy"
```

Then authorise it on the target machine:

```bash
cat /etc/ninja-ops/id_ed25519.pub >> ~/.ssh/authorized_keys
```

### GitHub version checking

With `GITHUB_REPO` set, the dashboard polls GitHub Releases every 30 minutes and shows a yellow badge when a newer version is available:

```
GITHUB_REPO=NinjaGoldfinch/ninja-ops   # owner/repo
GITHUB_TOKEN=ghp_...                    # optional — avoids 60 req/h unauthenticated limit
```

Without `GITHUB_REPO`, the dashboard still works — "Update available" simply never shows for platform services.

---

## Docker services

| Service | Image | Port | Credentials |
|---|---|---|---|
| PostgreSQL | `postgres:18-alpine` | 5432 | user: `ninja`, password: `ninja`, db: `ninja_ops` |
| Redis | `redis:7-alpine` | 6379 | No auth |

Data is persisted in named Docker volumes (`postgres_data`, `redis_data`).

```bash
# Stop services
docker compose -f docker/docker-compose.yml down

# Stop and remove volumes (destroys data)
docker compose -f docker/docker-compose.yml down -v

# View logs
docker compose -f docker/docker-compose.yml logs -f postgres
```

---

## Troubleshooting

**`pnpm install` fails with build errors (bcrypt, ssh2)**

Native modules require build tools. On macOS: `xcode-select --install`. On Linux: `apt install build-essential python3`.

**Port 5432 or 6379 already in use**

Another Postgres or Redis is running. Either stop it, or change the `ports` mapping in `docker/docker-compose.yml` and update `DATABASE_URL` / `REDIS_URL` in `.env`.

**`Invalid environment configuration` on startup**

The control plane validates all env vars at startup. Check that `.env` exists and all required variables are set. Missing `ENCRYPTION_KEY` (must be exactly 64 hex chars) is a common cause.

**Migrations fail with `relation does not exist`**

The database may not be ready yet. Check Docker is running: `docker compose -f docker/docker-compose.yml ps`. Wait for the healthcheck to pass (up to 30 seconds on first start).

**`pnpm dev` shows no output / exits immediately**

The `DATABASE_URL` or `REDIS_URL` may be unreachable. Confirm Docker services are healthy: `docker compose -f docker/docker-compose.yml ps`.
