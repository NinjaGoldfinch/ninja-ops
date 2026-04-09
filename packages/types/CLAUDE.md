# packages/types

Shared Zod schemas and inferred TypeScript types. No runtime logic — pure contracts.

## Rules specific to this package
- Zero dependencies other than zod.
- Every file in src/ corresponds to one domain (auth, deploy, proxmox, etc.).
- Do not import from other workspace packages here — this package has no workspace deps.
- All enums are z.enum([...]) not TypeScript enum. Export the const array alongside
  the schema so consumers can iterate values at runtime.
- Schemas that represent DB rows should include an id field (z.string().uuid()).
- All timestamps are z.string().datetime() — ISO 8601, UTC.

## File layout
src/
  auth.ts          — JWT payload, roles, session
  deploy.ts        — deploy jobs, triggers, results
  proxmox.ts       — nodes, guests, power states, snapshots
  logs.ts          — log entries, queries, Vector/Loki labels
  websocket.ts     — all WebSocket message shapes (client→server and server→client)
  api.ts           — response envelopes, pagination, errors
  agent.ts         — deploy-agent registration, heartbeat, commands
  index.ts         — re-exports everything
