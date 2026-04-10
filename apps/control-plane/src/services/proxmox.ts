import { Agent, fetch as undiciFetch } from 'undici'
import type {
  Guest,
  GuestType,
  PowerAction,
  Snapshot,
  CreateSnapshotRequest,
  NodeMetrics,
  GuestMetrics,
  LxcCreateRequest,
  QemuCreateRequest,
  ProxmoxStorage,
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

function authHeader(cfg: ProxmoxConfig): Record<string, string> {
  return { Authorization: `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}` }
}

// Proxmox REST API expects application/x-www-form-urlencoded for POST/PUT bodies.
// Despite the /api2/json path, it does not reliably parse a JSON request body.
function toFormBody(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      // Repeated keys for array params (e.g. command[]=bash&command[]=-c)
      for (const item of v) {
        params.append(k, String(item))
      }
    } else {
      params.set(k, String(v))
    }
  }
  return params
}

async function proxmoxFetch<T>(
  url: string,
  cfg: ProxmoxConfig,
  options: { method?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const fetchOptions: Parameters<typeof undiciFetch>[1] = {
    method: options.method ?? 'GET',
    headers: authHeader(cfg),
    dispatcher: insecureAgent,
  }
  if (options.body !== undefined) {
    fetchOptions.body = toFormBody(options.body)
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

    const [qemuStats, lxcStats] = await Promise.all([
      proxmoxFetch<ProxmoxGuestStats[]>(
        `${apiBase(cfg)}/nodes/${cfg.nodeName}/qemu`,
        cfg,
      ).catch(() => [] as ProxmoxGuestStats[]),
      proxmoxFetch<ProxmoxGuestStats[]>(
        `${apiBase(cfg)}/nodes/${cfg.nodeName}/lxc`,
        cfg,
      ).catch(() => [] as ProxmoxGuestStats[]),
    ])
    const guestStats = [...qemuStats, ...lxcStats]

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

  // ── Provisioning ─────────────────────────────────────────────────────────

  async nextVmid(cfg: ProxmoxConfig): Promise<number> {
    const id = await proxmoxFetch<number>(
      `${apiBase(cfg)}/cluster/nextid`,
      cfg,
    )
    return id
  }

  async createLxc(cfg: ProxmoxConfig, params: LxcCreateRequest, vmid: number): Promise<string> {
    if (!params.ipConfig) throw new Error('LXC config is missing ipConfig')
    const ipConfig = params.ipConfig.type === 'dhcp'
      ? `name=eth0,bridge=${params.bridge},ip=dhcp`
      : `name=eth0,bridge=${params.bridge},ip=${params.ipConfig.address}/${params.ipConfig.prefix},gw=${params.ipConfig.gateway}`

    const body: Record<string, unknown> = {
      vmid,
      hostname: params.hostname,
      ostemplate: params.osTemplate,
      cores: params.cores,
      memory: params.memory,
      swap: params.swap,
      rootfs: `${params.storage}:${params.diskSize}`,
      net0: ipConfig,
      unprivileged: params.unprivileged ? 1 : 0,
      onboot: params.startOnBoot ? 1 : 0,
      start: params.startAfterCreate ? 1 : 0,
      ...(params.dns !== undefined ? { nameserver: params.dns } : {}),
      ...(params.password !== undefined ? { password: params.password } : {}),
      ...(params.sshPublicKey !== undefined ? { sshpubkey: params.sshPublicKey } : {}),
      ...(params.tags.length > 0 ? { tags: params.tags.join(';') } : {}),
    }

    const upid = await proxmoxFetch<string>(
      `${apiBase(cfg)}/nodes/${cfg.nodeName}/lxc`,
      cfg,
      { method: 'POST', body },
    )
    return upid
  }

  async createQemu(cfg: ProxmoxConfig, params: QemuCreateRequest, vmid: number): Promise<string> {
    const body: Record<string, unknown> = {
      vmid,
      name: params.name,
      ostype: params.osType,
      cores: params.cores,
      sockets: params.sockets,
      memory: params.memory,
      scsi0: `${params.storage}:${params.diskSize},format=${params.diskFormat}`,
      ide2: `${params.isoImage},media=cdrom`,
      net0: `model=${params.netModel},bridge=${params.bridge}`,
      bios: params.bios,
      onboot: params.startOnBoot ? 1 : 0,
      scsihw: 'virtio-scsi-pci',
      boot: 'order=scsi0;ide2',
      ...(params.tags.length > 0 ? { tags: params.tags.join(';') } : {}),
    }

    const upid = await proxmoxFetch<string>(
      `${apiBase(cfg)}/nodes/${cfg.nodeName}/qemu`,
      cfg,
      { method: 'POST', body },
    )
    return upid
  }

  async waitForTask(
    cfg: ProxmoxConfig,
    upid: string,
    options: { pollIntervalMs?: number; timeoutMs?: number } = {},
  ): Promise<void> {
    const pollIntervalMs = options.pollIntervalMs ?? 2_000
    const timeoutMs = options.timeoutMs ?? 300_000
    const deadline = Date.now() + timeoutMs

    interface TaskStatus {
      status: string
      exitstatus?: string
    }

    const encodedUpid = encodeURIComponent(upid)

    while (Date.now() < deadline) {
      const status = await proxmoxFetch<TaskStatus>(
        `${apiBase(cfg)}/nodes/${cfg.nodeName}/tasks/${encodedUpid}/status`,
        cfg,
      )

      if (status.status === 'stopped') {
        if (status.exitstatus === 'OK') return
        throw AppError.proxmoxError(`Proxmox task failed: ${status.exitstatus ?? 'unknown error'}`)
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    throw AppError.proxmoxError(`Proxmox task timed out after ${timeoutMs / 1000}s`)
  }

  async listContent(
    cfg: ProxmoxConfig,
    contentType: 'vztmpl' | 'iso' | 'rootdir' | 'images',
  ): Promise<{ volid: string; size: number; storage: string }[]> {
    interface StorageRow { storage: string; content?: string }
    interface ContentRow { volid: string; size?: number }

    const storages = await proxmoxFetch<StorageRow[]>(
      `${apiBase(cfg)}/nodes/${cfg.nodeName}/storage`,
      cfg,
    )

    const results: { volid: string; size: number; storage: string }[] = []

    await Promise.all(
      storages
        .filter(s => s.content?.split(',').includes(contentType))
        .map(async s => {
          const items = await proxmoxFetch<ContentRow[]>(
            `${apiBase(cfg)}/nodes/${cfg.nodeName}/storage/${s.storage}/content?content=${contentType}`,
            cfg,
          ).catch(() => [] as ContentRow[])
          for (const item of items) {
            results.push({ volid: item.volid, size: item.size ?? 0, storage: s.storage })
          }
        }),
    )

    return results
  }

  async listStorages(cfg: ProxmoxConfig): Promise<ProxmoxStorage[]> {
    interface StorageRow {
      storage: string
      type: string
      avail?: number
      total?: number
      content?: string
      enabled?: number
    }

    const rows = await proxmoxFetch<StorageRow[]>(
      `${apiBase(cfg)}/nodes/${cfg.nodeName}/storage`,
      cfg,
    )

    return rows.map(r => ({
      storage: r.storage,
      type: r.type,
      avail: r.avail ?? 0,
      total: r.total ?? 0,
      content: (r.content ?? '').split(',').filter(Boolean),
      enabled: (r.enabled ?? 1) !== 0,
    }))
  }

  async getGuestStatus(cfg: ProxmoxConfig, type: GuestType, vmid: number): Promise<string> {
    interface GuestStatus { status: string }
    const status = await proxmoxFetch<GuestStatus>(
      `${guestPath(cfg, type, vmid)}/status/current`,
      cfg,
    )
    return status.status
  }

  async execInLxc(
    cfg: ProxmoxConfig,
    vmid: number,
    command: string[],
  ): Promise<{ upid: string }> {
    return proxmoxFetch<{ upid: string }>(
      `${apiBase(cfg)}/nodes/${cfg.nodeName}/lxc/${vmid}/exec`,
      cfg,
      { method: 'POST', body: { command } },
    )
  }
}

export const proxmoxService = new ProxmoxService()
