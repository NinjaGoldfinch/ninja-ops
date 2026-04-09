# apps/control-plane

Fastify REST + WebSocket API. Central service for the ninja-ops platform.

## Stack
- Fastify 5 + TypeScript (ESM)
- PostgreSQL via postgres.js
- Redis via ioredis
- BullMQ for job queues
- Zod for request validation (schemas from @ninja/types)
- Pino for structured logging
- ssh2 for SSH PTY terminals
- jose for JWT authentication
- @fastify/websocket for WebSocket support
- @fastify/swagger + @scalar/fastify-api-reference for API docs

## Structure rules
- All route handlers are thin — validate input, call a service, return the result.
  No business logic inside route files.
- Services own all business logic and database access.
- Plugins register shared behaviour (auth, RBAC, rate limiting, etc).
- Workers are BullMQ processors — one file per queue.
- Never import a service from another service. If shared logic is needed, extract it
  to a helper in src/lib/.
- All database queries use tagged template literals via postgres.js — no query builders,
  no ORM.
- Every route must declare its schema using @ninja/types Zod schemas converted to JSON
  Schema via zod-to-json-schema, or inline Zod schemas for simple cases.

## Auth rules
- Every route except POST /api/auth/login requires a valid JWT.
- Role checks use the requireRole() prehandler.
- WebSocket connections authenticate via an initial 'auth' message — token never in URL.
- Agent WebSocket connections authenticate via a separate 'auth' message with agentId + token.

## Error handling
- All errors thrown inside services must be AppError instances.
- Fastify's setErrorHandler catches AppError and maps it to the ApiError envelope from
  @ninja/types.
- Never let Postgres or ioredis errors propagate to the client unwrapped.

## Environment
- All env vars are validated at startup via Zod in src/config.ts.
- If any required var is missing or invalid, the process exits immediately with a clear message.
- Never access process.env directly outside src/config.ts.

## Testing
- Integration tests use a real Postgres and Redis instance spun up via Docker in CI.
- Unit tests mock the database and Redis.
- Every route must have at least one integration test covering the happy path.
- Auth and RBAC must be tested — verify that viewer-role requests are rejected on
  operator+ routes.

## Commits
After every meaningful unit of work (a working route, a passing service test, a
migration) — commit immediately using conventional commits with scope control-plane.
