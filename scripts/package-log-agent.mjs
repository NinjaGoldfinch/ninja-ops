#!/usr/bin/env node
/**
 * Bundles and packages the log-agent into a tarball.
 * Run via `pnpm package:log-agent`.
 * Output: apps/control-plane/log-agent-bundle.tar.gz
 */
import { execSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const agentDir = resolve(repoRoot, 'apps/log-agent')
const bundleDir = resolve(agentDir, 'dist-bundle')
const outFile = resolve(repoRoot, 'apps/control-plane/log-agent-bundle.tar.gz')

// Resolve esbuild from the agent package's own devDependencies
const requireFromAgent = createRequire(resolve(agentDir, 'package.json'))
const { build } = requireFromAgent('esbuild')

console.log('→ Bundling log-agent…')

await build({
  entryPoints: [resolve(agentDir, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['node:*'],
  banner: {
    js: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
  },
  outfile: resolve(bundleDir, 'index.js'),
})

console.log('→ Packaging log-agent tarball…')

// Strip macOS extended attributes (com.apple.provenance etc.) before taring
if (process.platform === 'darwin') {
  execSync(`xattr -cr "${bundleDir}"`, { stdio: 'inherit' })
}

// COPYFILE_DISABLE=1 prevents macOS copyfile resource forks
execSync(
  `tar -czf "${outFile}" -C "${bundleDir}" index.js`,
  { stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } },
)

console.log(`✓ Log-agent bundle written to ${outFile}`)
