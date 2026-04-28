import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../config.js'
import { childLogger } from '../lib/logger.js'
import type { ServiceVersion, ServiceName } from '@ninja/types'

const log = childLogger('service-versions')

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

function readPackageVersion(appName: string): string {
  try {
    const pkgPath = resolve(packageRoot, 'apps', appName, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

interface GithubRelease {
  tag_name: string
  target_commitish: string
}

interface GithubRef {
  ref: string
  object: { sha: string }
}

async function fetchLatestGithubRelease(repo: string): Promise<{ tag: string; sha: string }> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (config.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${config.GITHUB_TOKEN}`

  const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers })
  if (releaseRes.ok) {
    const release = await releaseRes.json() as GithubRelease
    return { tag: release.tag_name, sha: release.target_commitish }
  }

  // Fallback: latest tag
  const tagsRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/tags`, { headers })
  if (!tagsRes.ok) throw new Error(`GitHub API error: ${tagsRes.status}`)
  const tags = await tagsRes.json() as GithubRef[]
  if (!tags.length) throw new Error('No tags found in repo')
  const latest = tags[tags.length - 1]!
  const tagName = latest.ref.replace('refs/tags/', '')
  return { tag: tagName, sha: latest.object.sha }
}

export interface ServiceVersionCache {
  'control-plane': ServiceVersion
  'dashboard': ServiceVersion
}

let cache: ServiceVersionCache | null = null
let pollerTimer: ReturnType<typeof setInterval> | null = null

async function buildCache(): Promise<ServiceVersionCache> {
  const repo = config.GITHUB_REPO

  const makeVersion = async (service: ServiceName): Promise<ServiceVersion> => {
    const current = readPackageVersion(service)
    const checkedAt = new Date().toISOString()

    if (!repo) {
      return { service, current, latest: current, latestSha: '', updateAvailable: false, checkedAt }
    }

    try {
      const { tag, sha } = await fetchLatestGithubRelease(repo)
      const latest = tag.replace(/^v/, '')
      const updateAvailable = latest !== current
      return { service, current, latest, latestSha: sha, updateAvailable, checkedAt }
    } catch (err) {
      log.warn({ err }, `Failed to fetch GitHub release for ${service}`)
      return { service, current, latest: current, latestSha: '', updateAvailable: false, checkedAt }
    }
  }

  const [cp, dash] = await Promise.all([
    makeVersion('control-plane'),
    makeVersion('dashboard'),
  ])

  return { 'control-plane': cp, 'dashboard': dash }
}

export async function getServiceVersions(): Promise<ServiceVersionCache> {
  if (!cache) cache = await buildCache()
  return cache
}

export async function refreshServiceVersions(): Promise<ServiceVersionCache> {
  cache = await buildCache()
  return cache
}

export function startVersionPoller(intervalMs = config.SERVICE_VERSION_POLL_INTERVAL_MS): void {
  if (pollerTimer) return
  pollerTimer = setInterval(() => {
    refreshServiceVersions().catch((err: unknown) => {
      log.error({ err }, 'Service version poll failed')
    })
  }, intervalMs)
  pollerTimer.unref()
}

export function stopVersionPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer)
    pollerTimer = null
  }
}
