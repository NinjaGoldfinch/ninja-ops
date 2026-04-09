# Ninja Proxmox — Claude Code

## Project overview
Monorepo for a self-hosted Proxmox management and deployment platform.
Services: control-plane (Fastify), dashboard (React/Vite), deploy-agent, forge-cli, log-service.
Shared contracts live in packages/types.

## Stack
- Runtime: Node.js 22, pnpm 9, Turborepo
- Language: TypeScript (strict)
- Validation: Zod 3
- Testing: Vitest
- Linting: ESLint flat config + @typescript-eslint

## Key rules
- All public API surfaces must be defined in packages/types first.
- Never import from a sibling app — only from packages/*.
- Zod schemas are the source of truth; TypeScript types are inferred with z.infer<>.
- Every schema file exports both the Zod schema (PascalCase + "Schema" suffix) and the
  inferred type (PascalCase, no suffix). Example: export { DeployJobSchema, DeployJob }.
- Use z.discriminatedUnion for all union types that have a "type" or "kind" discriminant.
- No any. No ts-ignore. Treat every TypeScript error as a build failure.

## Commands
- pnpm dev              — start all services with hot reload
- pnpm build            — build all packages and apps
- pnpm test             — run all tests
- pnpm typecheck        — tsc --noEmit across the workspace
- pnpm lint             — eslint across the workspace

## Workflow
When adding a new shared type:
1. Define the Zod schema in the appropriate file under packages/types/src/
2. Export it from packages/types/src/index.ts
3. Run pnpm typecheck to verify no downstream breakage
4. Write at least one Vitest test covering the schema's parse and safeParse paths
