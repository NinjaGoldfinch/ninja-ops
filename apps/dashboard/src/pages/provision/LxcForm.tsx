import { useState } from 'react'
import { useNodes } from '@/hooks/useNodes'
import { useNodeTemplates, useNodeStorages, useCreateLxc } from '@/hooks/useProvisioning'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ApiRequestError } from '@/lib/api'
import type { LxcCreateRequest } from '@ninja/types'

interface FormState {
  nodeId: string
  vmid: string
  hostname: string
  osTemplate: string
  tags: string
  cores: string
  memory: string
  swap: string
  diskSize: string
  storage: string
  bridge: string
  ipType: 'dhcp' | 'static'
  address: string
  prefix: string
  gateway: string
  dns: string
  password: string
  confirmPassword: string
  sshPublicKey: string
  unprivileged: boolean
  startOnBoot: boolean
  startAfterCreate: boolean
  deployAgent: boolean
}

type FieldErrors = Partial<Record<keyof FormState | 'form', string>>

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/

interface LxcFormProps {
  defaultNodeId?: string
  onSuccess?: () => void
}

export function LxcForm({ defaultNodeId, onSuccess }: LxcFormProps) {
  const { data: nodes } = useNodes()
  const { mutate: create, isPending } = useCreateLxc()
  const { toast } = useToast()

  const [form, setForm] = useState<FormState>({
    nodeId: defaultNodeId ?? '', vmid: '', hostname: '', osTemplate: '', tags: '',
    cores: '1', memory: '512', swap: '512', diskSize: '8', storage: '',
    bridge: 'vmbr0', ipType: 'dhcp', address: '', prefix: '24', gateway: '',
    dns: '', password: '', confirmPassword: '', sshPublicKey: '',
    unprivileged: true, startOnBoot: true, startAfterCreate: true, deployAgent: false,
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const { data: templates, isLoading: loadingTemplates } = useNodeTemplates(form.nodeId)
  const { data: storages, isLoading: loadingStorages } = useNodeStorages(form.nodeId)

  const rootdirStorages = storages?.filter(s => s.content.includes('rootdir') || s.content.includes('images')) ?? []

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(f => ({ ...f, [field]: value }))
    setFieldErrors(e => ({ ...e, [field]: undefined }))
  }

  function setStr(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      set(field, e.target.value as FormState[typeof field])
    }
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    if (!form.nodeId) errors.nodeId = 'Required'
    if (!form.hostname.trim()) {
      errors.hostname = 'Required'
    } else if (!HOSTNAME_RE.test(form.hostname)) {
      errors.hostname = 'Alphanumeric and hyphens only; no leading/trailing hyphen'
    } else if (form.hostname.length > 63) {
      errors.hostname = 'Max 63 characters'
    }
    if (form.vmid && (isNaN(Number(form.vmid)) || Number(form.vmid) < 100 || Number(form.vmid) > 999_999_999)) {
      errors.vmid = 'Must be an integer between 100 and 999999999'
    }
    if (!form.osTemplate) errors.osTemplate = 'Required'
    if (!form.storage) errors.storage = 'Required'
    if (isNaN(Number(form.cores)) || Number(form.cores) < 1) errors.cores = 'Min 1'
    if (isNaN(Number(form.memory)) || Number(form.memory) < 64) errors.memory = 'Min 64 MB'
    if (form.ipType === 'static') {
      if (!form.address) errors.address = 'Required'
      if (!form.gateway) errors.gateway = 'Required'
      if (isNaN(Number(form.prefix)) || Number(form.prefix) < 1 || Number(form.prefix) > 32) errors.prefix = '1–32'
    }
    if (form.password && form.password.length < 8) errors.password = 'Min 8 characters'
    if (form.password !== form.confirmPassword) errors.confirmPassword = 'Passwords do not match'
    if (form.deployAgent && !form.startAfterCreate) {
      errors.deployAgent = "Auto-deploy requires 'Start after create' to be enabled"
    }
    return errors
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errors = validate()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    const ipConfig: LxcCreateRequest['ipConfig'] = form.ipType === 'dhcp'
      ? { type: 'dhcp' }
      : { type: 'static', address: form.address, prefix: Number(form.prefix), gateway: form.gateway }

    const payload: LxcCreateRequest = {
      nodeId: form.nodeId,
      ...(form.vmid ? { vmid: Number(form.vmid) } : {}),
      hostname: form.hostname.trim(),
      osTemplate: form.osTemplate,
      cores: Number(form.cores),
      memory: Number(form.memory),
      swap: Number(form.swap),
      diskSize: Number(form.diskSize),
      storage: form.storage,
      bridge: form.bridge || 'vmbr0',
      ipConfig,
      ...(form.dns.trim() ? { dns: form.dns.trim() } : {}),
      ...(form.password ? { password: form.password } : {}),
      ...(form.sshPublicKey.trim() ? { sshPublicKey: form.sshPublicKey.trim() } : {}),
      unprivileged: form.unprivileged,
      startOnBoot: form.startOnBoot,
      startAfterCreate: form.startAfterCreate,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      deployAgent: form.deployAgent,
    }

    create(payload, {
      onSuccess: (job) => {
        toast({ title: 'Provisioning started', description: `Job ${job.id.slice(0, 8)} created`, variant: 'success' })
        setForm(f => ({ ...f, hostname: '', vmid: '', osTemplate: '', password: '', confirmPassword: '', tags: '' }))
        onSuccess?.()
      },
      onError: (err) => {
        if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
          const details = err.details as Record<string, string> | undefined
          if (details) setFieldErrors(details as FieldErrors)
        }
        toast({ title: 'Failed to submit', description: String(err), variant: 'error' })
      },
    })
  }

  const err = (field: keyof FormState) =>
    fieldErrors[field] ? <p className="text-xs text-red-500 mt-0.5">{fieldErrors[field]}</p> : null

  const inputCls = (field: keyof FormState) =>
    fieldErrors[field] ? 'border-red-500' : ''

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">

      {/* Section 1 — Placement */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Placement</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="lxc-nodeId">Node</Label>
            <Select id="lxc-nodeId" value={form.nodeId} onChange={setStr('nodeId')} className={inputCls('nodeId')}>
              <option value="">Select a node…</option>
              {nodes?.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
            </Select>
            {err('nodeId')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lxc-vmid">VMID <span className="text-zinc-400">(optional — auto-assign)</span></Label>
            <Input id="lxc-vmid" type="number" value={form.vmid} onChange={setStr('vmid')} placeholder="auto" className={inputCls('vmid')} min={100} max={999999999} />
            {err('vmid')}
          </div>
        </div>
      </section>

      {/* Section 2 — Identity */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="lxc-hostname">Hostname</Label>
            <Input id="lxc-hostname" value={form.hostname} onChange={setStr('hostname')} placeholder="web-01" className={inputCls('hostname')} />
            {err('hostname')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lxc-osTemplate">OS Template</Label>
            <Select id="lxc-osTemplate" value={form.osTemplate} onChange={setStr('osTemplate')} className={inputCls('osTemplate')} disabled={!form.nodeId || loadingTemplates}>
              <option value="">{loadingTemplates ? 'Loading…' : 'Select a template…'}</option>
              {templates?.map(t => <option key={t.volid} value={t.volid}>{t.name}</option>)}
            </Select>
            {err('osTemplate')}
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="lxc-tags">Tags <span className="text-zinc-400">(comma-separated, optional)</span></Label>
            <Input id="lxc-tags" value={form.tags} onChange={setStr('tags')} placeholder="web, production" />
          </div>
        </div>
      </section>

      {/* Section 3 — Resources */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Resources</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="lxc-cores">CPU Cores</Label>
            <Input id="lxc-cores" type="number" value={form.cores} onChange={setStr('cores')} min={1} max={128} className={inputCls('cores')} />
            {err('cores')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lxc-memory">Memory (MB)</Label>
            <Input id="lxc-memory" type="number" value={form.memory} onChange={setStr('memory')} min={64} className={inputCls('memory')} />
            {err('memory')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lxc-swap">Swap (MB)</Label>
            <Input id="lxc-swap" type="number" value={form.swap} onChange={setStr('swap')} min={0} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lxc-diskSize">Disk Size (GB)</Label>
            <Input id="lxc-diskSize" type="number" value={form.diskSize} onChange={setStr('diskSize')} min={1} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="lxc-storage">Storage Pool</Label>
            <Select id="lxc-storage" value={form.storage} onChange={setStr('storage')} className={inputCls('storage')} disabled={!form.nodeId || loadingStorages}>
              <option value="">{loadingStorages ? 'Loading…' : 'Select storage…'}</option>
              {rootdirStorages.map(s => (
                <option key={s.storage} value={s.storage}>
                  {s.storage} ({s.type}) — {Math.round(s.avail / 1024 / 1024 / 1024)} GB free
                </option>
              ))}
            </Select>
            {err('storage')}
          </div>
        </div>
      </section>

      {/* Section 4 — Network */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Network</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="lxc-bridge">Bridge</Label>
            <Input id="lxc-bridge" value={form.bridge} onChange={setStr('bridge')} placeholder="vmbr0" />
          </div>
          <div className="space-y-1.5">
            <Label>IP Configuration</Label>
            <div className="flex gap-4 pt-1">
              {(['dhcp', 'static'] as const).map(t => (
                <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="ipType" value={t} checked={form.ipType === t} onChange={() => set('ipType', t)} />
                  {t === 'dhcp' ? 'DHCP' : 'Static'}
                </label>
              ))}
            </div>
          </div>
          {form.ipType === 'static' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="lxc-address">IP Address</Label>
                <Input id="lxc-address" value={form.address} onChange={setStr('address')} placeholder="192.168.1.100" className={inputCls('address')} />
                {err('address')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lxc-prefix">Prefix Length</Label>
                <Input id="lxc-prefix" type="number" value={form.prefix} onChange={setStr('prefix')} min={1} max={32} className={inputCls('prefix')} />
                {err('prefix')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lxc-gateway">Gateway</Label>
                <Input id="lxc-gateway" value={form.gateway} onChange={setStr('gateway')} placeholder="192.168.1.1" className={inputCls('gateway')} />
                {err('gateway')}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lxc-dns">DNS Server <span className="text-zinc-400">(optional)</span></Label>
                <Input id="lxc-dns" value={form.dns} onChange={setStr('dns')} placeholder="8.8.8.8" />
              </div>
            </>
          )}
        </div>
      </section>

      {/* Section 5 — Security */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Security</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="lxc-password">Root Password <span className="text-zinc-400">(optional)</span></Label>
            <Input id="lxc-password" type="password" value={form.password} onChange={setStr('password')} autoComplete="new-password" className={inputCls('password')} />
            {err('password')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lxc-confirmPassword">Confirm Password</Label>
            <Input id="lxc-confirmPassword" type="password" value={form.confirmPassword} onChange={setStr('confirmPassword')} autoComplete="new-password" className={inputCls('confirmPassword')} />
            {err('confirmPassword')}
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="lxc-sshPublicKey">SSH Public Key <span className="text-zinc-400">(optional)</span></Label>
            <textarea
              id="lxc-sshPublicKey"
              value={form.sshPublicKey}
              onChange={setStr('sshPublicKey')}
              rows={2}
              placeholder="ssh-ed25519 AAAA..."
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="lxc-unprivileged" checked={form.unprivileged} onChange={e => set('unprivileged', e.target.checked)} />
            <Label htmlFor="lxc-unprivileged">Unprivileged container</Label>
          </div>
        </div>
      </section>

      {/* Section 6 — Behaviour */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Behaviour</h3>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="lxc-startOnBoot" checked={form.startOnBoot} onChange={e => set('startOnBoot', e.target.checked)} />
          <Label htmlFor="lxc-startOnBoot">Start on boot</Label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="lxc-startAfterCreate" checked={form.startAfterCreate} onChange={e => set('startAfterCreate', e.target.checked)} />
          <Label htmlFor="lxc-startAfterCreate">Start after create</Label>
        </div>
      </section>

      {/* Section 7 — Agent */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Agent</h3>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="lxc-deployAgent"
            checked={form.deployAgent}
            onChange={e => set('deployAgent', e.target.checked)}
          />
          <Label htmlFor="lxc-deployAgent">Auto-deploy agent after provisioning</Label>
        </div>
        {form.deployAgent && form.startAfterCreate && (
          <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
            The deploy-agent will be installed inside this container automatically after it starts.
            This requires internet access from within the container to fetch the agent package.
          </div>
        )}
        {fieldErrors.deployAgent && (
          <p className="text-xs text-red-500">{fieldErrors.deployAgent}</p>
        )}
      </section>

      <div className="pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Submitting…' : 'Create LXC Container'}
        </Button>
      </div>
    </form>
  )
}
