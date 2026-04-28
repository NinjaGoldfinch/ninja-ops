#!/usr/bin/env node
/**
 * Bundles and packages the deploy-agent into a tarball.
 * Run via `pnpm package:agent`.
 * Output: apps/control-plane/agent-bundle.tar.gz
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const agentDir = resolve(repoRoot, 'apps/deploy-agent')
const bundleDir = resolve(agentDir, 'dist-bundle')
const outFile = resolve(repoRoot, 'apps/control-plane/agent-bundle.tar.gz')

// Resolve esbuild from the agent package's own devDependencies
const requireFromAgent = createRequire(resolve(agentDir, 'package.json'))
const { build } = requireFromAgent('esbuild')

const pkg = JSON.parse(readFileSync(resolve(agentDir, 'package.json'), 'utf8'))
const version = pkg.version

console.log(`→ Bundling deploy-agent v${version}…`)

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
  define: {
    __AGENT_VERSION__: JSON.stringify(version),
  },
  outfile: resolve(bundleDir, 'index.js'),
})

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

console.log(`✓ Agent bundle v${version} written to ${outFile}`)
