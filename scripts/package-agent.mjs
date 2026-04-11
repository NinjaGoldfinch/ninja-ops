#!/usr/bin/env node
/**
 * Packages the pre-bundled deploy-agent into a tarball.
 * Run via `pnpm package:agent` — esbuild must have already written dist-bundle/index.js.
 * Output: apps/control-plane/agent-bundle.tar.gz
 */
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const agentDir = resolve(repoRoot, 'apps/deploy-agent')
const bundleDir = resolve(agentDir, 'dist-bundle')
const outFile = resolve(repoRoot, 'apps/control-plane/agent-bundle.tar.gz')

if (!existsSync(resolve(bundleDir, 'index.js'))) {
  console.error('✗ apps/deploy-agent/dist-bundle/index.js not found — esbuild step must have failed')
  process.exit(1)
}

console.log('→ Packaging tarball…')

// Strip macOS extended attributes (com.apple.provenance etc.) before taring
if (process.platform === 'darwin') {
  execSync(`xattr -cr "${bundleDir}"`, { stdio: 'inherit' })
}

// COPYFILE_DISABLE=1 prevents macOS copyfile resource forks
execSync(
  `tar -czf "${outFile}" -C "${bundleDir}" index.js`,
  { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } },
)

console.log(`✓ Agent bundle written to ${outFile}`)