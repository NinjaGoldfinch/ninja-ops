# apps/dashboard

React 19 + Vite 6 frontend for the ninja-ops platform.

## Stack
- React 19 (ESM, no CRA)
- Vite 6
- TypeScript (strict)
- Tailwind CSS v4
- shadcn/ui components
- TanStack Query v5 (data fetching + caching)
- TanStack Router v1 (file-based routing)
- Zustand (auth + UI state)
- Recharts (metrics charts)
- @xterm/xterm (terminal emulator)
- @ninja/types (shared schemas — import types only, never Zod at runtime)

## Structure rules
- All API calls go through src/lib/api.ts — never fetch() directly in components.
- All WebSocket logic lives in src/lib/ws.ts and src/hooks/useWebSocket.ts.
- Components are dumb — they receive data via props or hooks, never call API directly.
- Pages live in src/pages/, reusable components in src/components/.
- Each page owns its data fetching via TanStack Query hooks in src/hooks/.
- Never import from apps/control-plane. Types come from @ninja/types only.
- All forms use controlled components — no uncontrolled inputs.
- Dark mode is supported via Tailwind's `dark:` variant. Default to system preference,
  allow toggle stored in Zustand + localStorage.

## Auth rules
- JWT is stored in Zustand (in-memory) + sessionStorage. Never localStorage.
- All API requests attach Authorization: Bearer <token> via the api.ts client.
- On 401 response, clear auth state and redirect to /login.
- The WebSocket connection sends the JWT as the first auth message after connecting.

## Commits
After every meaningful unit of work commit using conventional commits with scope dashboard.
