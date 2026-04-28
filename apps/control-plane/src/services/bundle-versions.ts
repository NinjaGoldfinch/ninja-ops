import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { config } from '../config.js'
import type { BundleInfo } from '@ninja/types'

function computeHash(filePath: string): string {
  if (!existsSync(filePath)) return 'no-bundle'
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

let _info: BundleInfo | null = null

export function getBundleVersions(): BundleInfo {
  if (!_info) {
    _info = {
      deployAgentHash: computeHash(config.AGENT_BUNDLE_PATH),
      logAgentHash:    computeHash(config.LOG_AGENT_BUNDLE_PATH),
    }
  }
  return _info
}

export function invalidateBundleVersions(): void {
  _info = null
}
