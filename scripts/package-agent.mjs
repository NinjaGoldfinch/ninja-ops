#!/usr/bin/env node
/**
 * Builds the deploy-agent tarball served by the control plane at GET /api/agents/download.
 * Output: agent-bundle.tar.gz in the repo root (matches AGENT_BUNDLE_PATH default).
 *
 * Usage:
 *   pnpm package:agent
 *   pnpm --filter @ninja/deploy-agent package
 */
import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const agentDir = resolve(repoRoot, 'apps/deploy-agent')
const distDir = resolve(agentDir, 'dist')
const outFile = resolve(repoRoot, 'agent-bundle.tar.gz')

if (!existsSync(distDir)) {
  console.error('✗ apps/deploy-agent/dist not found — run `pnpm --filter @ninja/deploy-agent build` first')
  process.exit(1)
}

console.log('→ Packaging deploy-agent…')

// Include dist/ and package.json so the agent can resolve its own version
execSync(
  `tar -czf "${outFile}" -C "${agentDir}" dist package.json`,
  { stdio: 'inherit' },
)

console.log(`✓ Agent bundle written to ${outFile}`)
console.log('  Set AGENT_BUNDLE_PATH in env/control-plane.env if needed (default: ./agent-bundle.tar.gz)')
