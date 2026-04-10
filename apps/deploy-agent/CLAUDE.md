# apps/deploy-agent

Lightweight deploy agent — runs inside each managed Proxmox LXC container.

## Key rules
- No framework. Plain Node.js + ws package only.
- Never import from apps/control-plane. Types come from @ninja/types only.
- Keep the binary small — no heavy deps.
- All env vars validated in src/config.ts via Zod. Never access process.env elsewhere.
- Never throw unhandled errors — the agent must stay alive and reconnect.

## Commits
After each working unit (registration, WS connect, heartbeat, deploy runner) —
commit with conventional commits, scope deploy-agent.
