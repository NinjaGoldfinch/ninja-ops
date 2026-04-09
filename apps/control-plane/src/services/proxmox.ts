import { Agent, fetch as undiciFetch } from 'undici'
import type {
  Guest,
  GuestType,
  PowerAction,
  Snapshot,
  CreateSnapshotRequest,
  NodeMetrics,
  GuestMetrics,
} from '@ninja/types'
import { AppError } from '../errors.js'

// Undici agent that ignores self-signed certificates (Proxmox default)
const insecureAgent = new Agent({
  connect: { rejectUnauthorized: false },
})

interface ProxmoxConfig {
  host: string
  port: number
  tokenId: string
  tokenSecret: string
  nodeName: string
}

interface ProxmoxGuestRow {
  vmid: number
  name?: string
  status: string
  cpus?: number
  maxmem?: number
  maxdisk?: number
  uptime?: number
  tags?: string
}

interface ProxmoxNodeStatus {
  cpu?: number
  memory?: { used?: number; total?: number }
  rootfs?: { used?: number; total?: number }
  uptime?: number
}

function apiBase(cfg: ProxmoxConfig): string {
  return `https://${cfg.host}:${cfg.port}/api2/json`
}

function headers(cfg: ProxmoxConfig): Record<string, string> {
  return {
    Authorization: `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`,
    'Content-Type': 'application/json',
  }
}

async function proxmoxFetch<T>(
  url: string,
  cfg: ProxmoxConfig,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const fetchOptions: Parameters<typeof undiciFetch>[1] = {
    method: options.method ?? 'GET',
    headers: headers(cfg),
    dispatcher: insecureAgent,
  }
  if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body)
  }
  const response = await undiciFetch(url, fetchOptions)

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText)
    throw AppError.proxmoxError(`Proxmox API error ${response.status}: ${text}`)
  }

  const json = await response.json() as { data: T }
  return json.data
}

function guestPath(cfg: ProxmoxConfig, type: GuestType, vmid: number): string {
  return `${apiBase(cfg)}/nodes/${cfg.nodeName}/${type}/${vmid}`
}

export class ProxmoxService {
  async testConnection(cfg: Omit<ProxmoxConfig, 'nodeName'>): Promise<void> {
    await proxmoxFetch(
      `${apiBase(cfg as ProxmoxConfig)}/version`,
      cfg as ProxmoxConfig,
    )
  }

  async listGuests(cfg: ProxmoxConfig, nodeId: string): Promise<Guest[]> {
    const [qemuList, lxcList] = await Promise.all([
      proxmoxFetch<ProxmoxGuestRow[]>(
        `${apiBase(cfg)}/nodes/${cfg.nodeName}/qemu`,
        cfg,
      ).catch(() => [] as ProxmoxGuestRow[]),
      proxmoxFetch<ProxmoxGuestRow[]>(
        `${apiBase(cfg)}/nodes/${cfg.nodeName}/lxc`,
        cfg,
      ).catch(() => [] as ProxmoxGuestRow[]),
    ])

    const toGuest = (row: ProxmoxGuestRow, type: GuestType): Guest => ({
      vmid: row.vmid,
      name: row.name ?? `${type}-${row.vmid}`,
      type,
      status: (row.status as Guest['status']) ?? 'unknown',
      nodeId,
      nodeName: cfg.nodeName,
      ...(row.cpus !== undefined ? { cpus: row.cpus } : {}),
      ...(row.maxmem !== undefined ? { maxmem: row.maxmem } : {}),
      ...(row.maxdisk !== undefined ? { maxdisk: row.maxdisk } : {}),
      ...(row.uptime !== undefined ? { uptime: row.uptime } : {}),
      // Proxmox returns tags as a semicolon-separated string
      ...(row.tags !== undefined
        ? { tags: row.tags.split(';').filter(Boolean) }
        : {}),
    })

    return [
      ...qemuList.map(r => toGuest(r, 'qemu')),
      ...lxcList.map(r => toGuest(r, 'lxc')),
    ]
  }

  async powerAction(
    cfg: ProxmoxConfig,
    type: GuestType,
    vmid: number,
    action: PowerAction,
  ): Promise<void> {
    await proxmoxFetch(
      `${guestPath(cfg, type, vmid)}/status/${action}`,
      cfg,
      { method: 'POST' },
    )
  }

  async listSnapshots(
    cfg: ProxmoxConfig,
    type: GuestType,
    vmid: number,
  ): Promise<Snapshot[]> {
    interface ProxmoxSnap {
      name: string
      description?: string
      snaptime?: number
      vmstate?: number  // Proxmox returns 0/1
      parent?: string
    }
    const snaps = await proxmoxFetch<ProxmoxSnap[]>(
      `${guestPath(cfg, type, vmid)}/snapshot`,
      cfg,
    )
    return snaps
      .filter(s => s.name !== 'current')
      .map((s): Snapshot => ({
        name: s.name,
        snaptime: s.snaptime ?? 0,
        vmstate: Boolean(s.vmstate),
        ...(s.description !== undefined ? { description: s.description } : {}),
        ...(s.parent !== undefined ? { parent: s.parent } : {}),
      }))
  }

  async createSnapshot(
    cfg: ProxmoxConfig,
    type: GuestType,
    vmid: number,
    data: CreateSnapshotRequest,
  ): Promise<void> {
    await proxmoxFetch(
      `${guestPath(cfg, type, vmid)}/snapshot`,
      cfg,
      { method: 'POST', body: data },
    )
  }

  async deleteSnapshot(
    cfg: ProxmoxConfig,
    type: GuestType,
    vmid: number,
    name: string,
  ): Promise<void> {
    await proxmoxFetch(
      `${guestPath(cfg, type, vmid)}/snapshot/${name}`,
      cfg,
      { method: 'DELETE' },
    )
  }

  async getMetrics(
    cfg: ProxmoxConfig,
    nodeId: string,
  ): Promise<{ node: NodeMetrics; guests: GuestMetrics[] }> {
    const nodeStatus = await proxmoxFetch<ProxmoxNodeStatus>(
      `${apiBase(cfg)}/nodes/${cfg.nodeName}/status`,
      cfg,
    )

    const node: NodeMetrics = {
      nodeId,
      timestamp: new Date().toISOString(),
      cpu: nodeStatus.cpu ?? 0,
      mem: nodeStatus.memory?.used ?? 0,
      maxmem: nodeStatus.memory?.total ?? 0,
      disk: nodeStatus.rootfs?.used ?? 0,
      maxdisk: nodeStatus.rootfs?.total ?? 0,
      uptime: nodeStatus.uptime ?? 0,
    }

    interface ProxmoxGuestStats {
      vmid: number
      type: string
      cpu?: number
      mem?: number
      maxmem?: number
      disk?: number
      maxdisk?: number
      netin?: number
      netout?: number
    }

    const guestStats = await proxmoxFetch<ProxmoxGuestStats[]>(
      `${apiBase(cfg)}/nodes/${cfg.nodeName}/qemu?full=1`,
      cfg,
    ).catch(() => [] as ProxmoxGuestStats[])

    const guests: GuestMetrics[] = guestStats.map(g => ({
      vmid: g.vmid,
      nodeId,
      timestamp: new Date().toISOString(),
      cpu: g.cpu ?? 0,
      mem: g.mem ?? 0,
      maxmem: g.maxmem ?? 0,
      disk: g.disk ?? 0,
      maxdisk: g.maxdisk ?? 0,
      netin: g.netin ?? 0,
      netout: g.netout ?? 0,
    }))

    return { node, guests }
  }
}

export const proxmoxService = new ProxmoxService()
