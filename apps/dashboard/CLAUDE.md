# apps/dashboard

React 19 + Vite 5 frontend for the ninja-ops platform. Runs on port 5173; Vite proxies `/api/*` and `/ws` to `localhost:3000`.

## Stack
- React 19 (ESM, no CRA)
- Vite 5
- TypeScript (strict)
- Tailwind CSS v4
- TanStack Query v5 (data fetching + caching)
- TanStack Router v1 (code-based routing — no file generator)
- Zustand v5 (auth + UI state)
- Recharts v2 (metrics charts)
- @xterm/xterm v5 (terminal emulator)
- @ninja/types (shared schemas — import types only, never Zod at runtime)

## Routing architecture
Routes are assembled manually in `src/router.ts`. There is NO file-based route generation.
- `src/root-route.ts` — rootRoute, no auth, no layout (login lives here)
- `src/layout-route.tsx` — auth guard (beforeLoad) + AppLayout wrapper; parent of all authenticated pages
- `src/router.ts` — imports all routes and builds the tree

Import `rootRoute` from `@/root-route` and `layoutRoute` from `@/layout-route` in page files — never from `@/router` (circular import).

## Structure rules
- All API calls go through src/lib/api.ts — never fetch() directly in components.
- All WebSocket logic lives in src/lib/ws.ts (singleton). Subscribe via ws.on() in useEffect.
- Components are dumb — they receive data via props or hooks, never call API directly.
- Pages live in src/pages/, reusable components in src/components/.
- Each page owns its data fetching via TanStack Query hooks in src/hooks/.
- Never import from apps/control-plane. Types come from @ninja/types only.
- All forms use controlled components — no uncontrolled inputs.
- Dark mode is supported via Tailwind's `dark:` variant. Toggle stored in Zustand + localStorage.

## Auth rules
- JWT is stored in Zustand (in-memory) + sessionStorage. Never localStorage.
- All API requests attach Authorization: Bearer <token> via the api.ts client.
- On 401 response, clear auth state and redirect to /login.
- The WebSocket connection sends the JWT as the first auth message after connecting.

## Commits
After every meaningful unit of work commit using conventional commits with scope dashboard.
