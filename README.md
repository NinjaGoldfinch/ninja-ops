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
│   ├── deploy-agent/       # Agent that runs on each managed container (planned)
│   ├── forge-cli/          # CLI tool (planned)
│   └── log-service/        # Log aggregation service (planned)
├── packages/
│   └── types/              # Shared Zod schemas and TypeScript types
├── scripts/
│   └── setup-env.sh        # First-time environment setup
└── docker/
    └── docker-compose.yml  # Local dev: Postgres + Redis
```

## Quick start

### Automated (recommended)

```bash
./scripts/setup-env.sh
```

Checks prerequisites, generates secrets, writes `apps/control-plane/.env`, starts Docker, installs dependencies, and runs migrations in one step. Pass `--help` for all options.

### Manual

```bash
# 1. Install dependencies
pnpm install

# 2. Start dev infrastructure
docker compose -f docker/docker-compose.yml up -d

# 3. Set up control-plane environment
cp apps/control-plane/.env.example apps/control-plane/.env
# Edit .env — see docs/setup.md for secret generation commands

# 4. Run database migrations
pnpm --filter @ninja/control-plane db:migrate

# 5. Seed the admin user (default: admin / changeme123!)
pnpm --filter @ninja/control-plane db:seed

# 6. Start all services with hot reload
pnpm dev
```

| Service | URL |
|---|---|
| Dashboard | `http://localhost:5173` |
| Control plane API | `http://localhost:3000` |
| API docs (Scalar) | `http://localhost:3000/api/docs` |

Default login: **admin** / **changeme123!**

> `pnpm dev` uses Turborepo's TUI — each service gets its own pane. Press `1`/`2` to switch between them.

## Workspace commands

| Command | Description |
|---|---|
| `pnpm dev` | Start all services with hot reload |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm lint:fix` | Lint and auto-fix |

## Documentation

- [Setup guide](docs/setup.md) — detailed local dev setup, env var reference, troubleshooting
- [Architecture](docs/architecture.md) — system design, data flows, API inventory
