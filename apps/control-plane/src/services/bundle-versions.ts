import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BundleInfo } from '@ninja/types'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

function readVersion(relPath: string): string {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, relPath), 'utf8')) as { version: string }
  return pkg.version
}

const _info: BundleInfo = {
  deployAgentVersion: readVersion('apps/deploy-agent/package.json'),
  logAgentVersion:    readVersion('apps/log-agent/package.json'),
}

export function getBundleVersions(): BundleInfo {
  return _info
}
