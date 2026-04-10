import { useState } from 'react'
import { useNodes } from '@/hooks/useNodes'
import { useNodeIsos, useNodeStorages, useCreateQemu } from '@/hooks/useProvisioning'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ApiRequestError } from '@/lib/api'
import type { QemuCreateRequest } from '@ninja/types'

interface FormState {
  nodeId: string
  vmid: string
  name: string
  osType: string
  isoImage: string
  tags: string
  cores: string
  sockets: string
  memory: string
  diskSize: string
  storage: string
  diskFormat: 'raw' | 'qcow2' | 'vmdk'
  bridge: string
  netModel: 'virtio' | 'e1000' | 'rtl8139'
  bios: 'seabios' | 'ovmf'
  startOnBoot: boolean
  startAfterCreate: boolean
}

type FieldErrors = Partial<Record<keyof FormState, string>>

const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/

const OS_TYPES = [
  { value: 'l26', label: 'Linux 6.x (l26)' },
  { value: 'l24', label: 'Linux 2.4 (l24)' },
  { value: 'win11', label: 'Windows 11' },
  { value: 'win10', label: 'Windows 10' },
  { value: 'win2k22', label: 'Windows Server 2022' },
  { value: 'other', label: 'Other' },
]

export function QemuForm() {
  const { data: nodes } = useNodes()
  const { mutate: create, isPending } = useCreateQemu()
  const { toast } = useToast()

  const [form, setForm] = useState<FormState>({
    nodeId: '', vmid: '', name: '', osType: 'l26', isoImage: '', tags: '',
    cores: '2', sockets: '1', memory: '2048', diskSize: '32', storage: '',
    diskFormat: 'raw', bridge: 'vmbr0', netModel: 'virtio', bios: 'seabios',
    startOnBoot: true, startAfterCreate: false,
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const { data: isos, isLoading: loadingIsos } = useNodeIsos(form.nodeId)
  const { data: storages, isLoading: loadingStorages } = useNodeStorages(form.nodeId)

  const imageStorages = storages?.filter(s => s.content.includes('images') || s.content.includes('rootdir')) ?? []

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(f => ({ ...f, [field]: value }))
    setFieldErrors(e => ({ ...e, [field]: undefined }))
  }

  function setStr(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      set(field, e.target.value as FormState[typeof field])
    }
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {}
    if (!form.nodeId) errors.nodeId = 'Required'
    if (!form.name.trim()) {
      errors.name = 'Required'
    } else if (!HOSTNAME_RE.test(form.name)) {
      errors.name = 'Alphanumeric and hyphens only; no leading/trailing hyphen'
    }
    if (form.vmid && (isNaN(Number(form.vmid)) || Number(form.vmid) < 100 || Number(form.vmid) > 999_999_999)) {
      errors.vmid = 'Must be an integer between 100 and 999999999'
    }
    if (!form.isoImage) errors.isoImage = 'Required'
    if (!form.storage) errors.storage = 'Required'
    if (isNaN(Number(form.cores)) || Number(form.cores) < 1) errors.cores = 'Min 1'
    if (isNaN(Number(form.memory)) || Number(form.memory) < 256) errors.memory = 'Min 256 MB'
    return errors
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errors = validate()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    const payload: QemuCreateRequest = {
      nodeId: form.nodeId,
      ...(form.vmid ? { vmid: Number(form.vmid) } : {}),
      name: form.name.trim(),
      osType: form.osType as QemuCreateRequest['osType'],
      isoImage: form.isoImage,
      cores: Number(form.cores),
      sockets: Number(form.sockets),
      memory: Number(form.memory),
      diskSize: Number(form.diskSize),
      storage: form.storage,
      diskFormat: form.diskFormat,
      bridge: form.bridge || 'vmbr0',
      netModel: form.netModel,
      bios: form.bios,
      startOnBoot: form.startOnBoot,
      startAfterCreate: form.startAfterCreate,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    }

    create(payload, {
      onSuccess: (job) => {
        toast({ title: 'Provisioning started', description: `Job ${job.id.slice(0, 8)} created`, variant: 'success' })
        setForm(f => ({ ...f, name: '', vmid: '', isoImage: '', tags: '' }))
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
            <Label htmlFor="qemu-nodeId">Node</Label>
            <Select id="qemu-nodeId" value={form.nodeId} onChange={setStr('nodeId')} className={inputCls('nodeId')}>
              <option value="">Select a node…</option>
              {nodes?.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
            </Select>
            {err('nodeId')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-vmid">VMID <span className="text-zinc-400">(optional — auto-assign)</span></Label>
            <Input id="qemu-vmid" type="number" value={form.vmid} onChange={setStr('vmid')} placeholder="auto" className={inputCls('vmid')} min={100} max={999999999} />
            {err('vmid')}
          </div>
        </div>
      </section>

      {/* Section 2 — Identity */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="qemu-name">VM Name</Label>
            <Input id="qemu-name" value={form.name} onChange={setStr('name')} placeholder="vm-debian" className={inputCls('name')} />
            {err('name')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-osType">OS Type</Label>
            <Select id="qemu-osType" value={form.osType} onChange={setStr('osType')}>
              {OS_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="qemu-isoImage">ISO Image</Label>
            <Select id="qemu-isoImage" value={form.isoImage} onChange={setStr('isoImage')} className={inputCls('isoImage')} disabled={!form.nodeId || loadingIsos}>
              <option value="">{loadingIsos ? 'Loading…' : 'Select an ISO…'}</option>
              {isos?.map(i => <option key={i.volid} value={i.volid}>{i.name}</option>)}
            </Select>
            {err('isoImage')}
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="qemu-tags">Tags <span className="text-zinc-400">(comma-separated, optional)</span></Label>
            <Input id="qemu-tags" value={form.tags} onChange={setStr('tags')} placeholder="vm, windows" />
          </div>
        </div>
      </section>

      {/* Section 3 — Resources */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Resources</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="qemu-cores">CPU Cores</Label>
            <Input id="qemu-cores" type="number" value={form.cores} onChange={setStr('cores')} min={1} max={128} className={inputCls('cores')} />
            {err('cores')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-sockets">CPU Sockets</Label>
            <Input id="qemu-sockets" type="number" value={form.sockets} onChange={setStr('sockets')} min={1} max={4} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-memory">Memory (MB)</Label>
            <Input id="qemu-memory" type="number" value={form.memory} onChange={setStr('memory')} min={256} className={inputCls('memory')} />
            {err('memory')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-diskSize">Disk Size (GB)</Label>
            <Input id="qemu-diskSize" type="number" value={form.diskSize} onChange={setStr('diskSize')} min={1} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-storage">Storage Pool</Label>
            <Select id="qemu-storage" value={form.storage} onChange={setStr('storage')} className={inputCls('storage')} disabled={!form.nodeId || loadingStorages}>
              <option value="">{loadingStorages ? 'Loading…' : 'Select storage…'}</option>
              {imageStorages.map(s => (
                <option key={s.storage} value={s.storage}>
                  {s.storage} ({s.type}) — {Math.round(s.avail / 1024 / 1024 / 1024)} GB free
                </option>
              ))}
            </Select>
            {err('storage')}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-diskFormat">Disk Format</Label>
            <Select id="qemu-diskFormat" value={form.diskFormat} onChange={setStr('diskFormat')}>
              <option value="raw">raw</option>
              <option value="qcow2">qcow2</option>
              <option value="vmdk">vmdk</option>
            </Select>
          </div>
        </div>
      </section>

      {/* Section 4 — Network */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Network</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="qemu-bridge">Bridge</Label>
            <Input id="qemu-bridge" value={form.bridge} onChange={setStr('bridge')} placeholder="vmbr0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qemu-netModel">Network Model</Label>
            <Select id="qemu-netModel" value={form.netModel} onChange={setStr('netModel')}>
              <option value="virtio">VirtIO (recommended)</option>
              <option value="e1000">Intel E1000</option>
              <option value="rtl8139">Realtek RTL8139</option>
            </Select>
          </div>
        </div>
      </section>

      {/* Section 5 — System */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">System</h3>
        <div className="space-y-2">
          <Label>BIOS</Label>
          <div className="flex gap-4">
            {(['seabios', 'ovmf'] as const).map(b => (
              <label key={b} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" name="bios" value={b} checked={form.bios === b} onChange={() => set('bios', b)} />
                {b === 'seabios' ? 'SeaBIOS (default)' : 'UEFI (OVMF)'}
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="qemu-startOnBoot" checked={form.startOnBoot} onChange={e => set('startOnBoot', e.target.checked)} />
          <Label htmlFor="qemu-startOnBoot">Start on boot</Label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="qemu-startAfterCreate" checked={form.startAfterCreate} onChange={e => set('startAfterCreate', e.target.checked)} />
          <Label htmlFor="qemu-startAfterCreate">Start after create</Label>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          VMs typically need manual setup after booting from the ISO before starting automatically.
        </p>
      </section>

      <div className="pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Submitting…' : 'Create QEMU VM'}
        </Button>
      </div>
    </form>
  )
}
