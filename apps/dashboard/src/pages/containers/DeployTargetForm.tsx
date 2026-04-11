import { useState } from 'react'
import { useCreateDeployTarget } from '@/hooks/useDeploy'
import { useGuests } from '@/hooks/useGuests'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ApiRequestError } from '@/lib/api'
import type { ProxmoxNode } from '@ninja/types'

interface DeployTargetFormProps {
  nodes: ProxmoxNode[]
  defaultNodeId?: string
  defaultVmid?: number
  onSuccess?: () => void
}

interface FormState {
  repository: string
  branch: string
  nodeId: string
  vmid: string
  workingDirectory: string
  restartCommand: string
  preDeployCommand: string
  postDeployCommand: string
  timeoutSeconds: string
}

type FieldErrors = Partial<Record<keyof FormState, string>>

export function DeployTargetForm({ nodes, defaultNodeId = '', defaultVmid, onSuccess }: DeployTargetFormProps) {
  const [form, setForm] = useState<FormState>({
    repository: '',
    branch: 'main',
    nodeId: defaultNodeId,
    vmid: defaultVmid ? String(defaultVmid) : '',
    workingDirectory: '/opt/app',
    restartCommand: '',
    preDeployCommand: '',
    postDeployCommand: '',
    timeoutSeconds: '300',
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const { mutate: create, isPending } = useCreateDeployTarget()
  const { toast } = useToast()

  const { data: guests } = useGuests(form.nodeId)
  const lxcGuests = guests?.filter(g => g.type === 'lxc') ?? []

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm(f => ({ ...f, [field]: e.target.value }))
      setFieldErrors(fe => ({ ...fe, [field]: undefined }))
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const errors: FieldErrors = {}
    if (!form.repository.trim()) errors.repository = 'Required'
    if (!form.branch.trim()) errors.branch = 'Required'
    if (!form.nodeId) errors.nodeId = 'Required'
    if (!form.vmid || isNaN(Number(form.vmid)) || Number(form.vmid) <= 0) errors.vmid = 'Must be a positive integer'
    if (!form.workingDirectory.trim()) errors.workingDirectory = 'Required'
    if (!form.restartCommand.trim()) errors.restartCommand = 'Required'

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    create(
      {
        repository: form.repository.trim(),
        branch: form.branch.trim(),
        nodeId: form.nodeId,
        vmid: Number(form.vmid),
        workingDirectory: form.workingDirectory.trim(),
        restartCommand: form.restartCommand.trim(),
        ...(form.preDeployCommand.trim() ? { preDeployCommand: form.preDeployCommand.trim() } : {}),
        ...(form.postDeployCommand.trim() ? { postDeployCommand: form.postDeployCommand.trim() } : {}),
        timeoutSeconds: Number(form.timeoutSeconds) || 300,
      },
      {
        onSuccess: () => {
          toast({ title: 'Deploy target created', variant: 'success' })
          onSuccess?.()
        },
        onError: (err) => {
          if (err instanceof ApiRequestError && err.code === 'VALIDATION_ERROR') {
            const details = err.details as Record<string, string> | undefined
            if (details) setFieldErrors(details as FieldErrors)
          }
          toast({ title: 'Failed to create target', description: String(err), variant: 'error' })
        },
      },
    )
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="dt-repository">Repository</Label>
          <Input
            id="dt-repository"
            value={form.repository}
            onChange={set('repository')}
            placeholder="owner/repo-name"
            className={fieldErrors.repository ? 'border-red-500' : ''}
          />
          {fieldErrors.repository && <p className="text-xs text-red-500">{fieldErrors.repository}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dt-branch">Branch</Label>
          <Input
            id="dt-branch"
            value={form.branch}
            onChange={set('branch')}
            className={fieldErrors.branch ? 'border-red-500' : ''}
          />
          {fieldErrors.branch && <p className="text-xs text-red-500">{fieldErrors.branch}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dt-nodeId">Node</Label>
          <Select
            id="dt-nodeId"
            value={form.nodeId}
            onChange={set('nodeId')}
            className={fieldErrors.nodeId ? 'border-red-500' : ''}
          >
            <option value="">Select a node…</option>
            {nodes.map(n => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </Select>
          {fieldErrors.nodeId && <p className="text-xs text-red-500">{fieldErrors.nodeId}</p>}
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="dt-vmid">Container</Label>
          {lxcGuests.length > 0 ? (
            <Select
              id="dt-vmid"
              value={form.vmid}
              onChange={set('vmid')}
              className={fieldErrors.vmid ? 'border-red-500' : ''}
            >
              <option value="">Select a container…</option>
              {lxcGuests.map(g => (
                <option key={g.vmid} value={String(g.vmid)}>{g.name} (VMID {g.vmid})</option>
              ))}
            </Select>
          ) : (
            <Input
              id="dt-vmid"
              type="number"
              value={form.vmid}
              onChange={set('vmid')}
              placeholder="100"
              className={fieldErrors.vmid ? 'border-red-500' : ''}
            />
          )}
          {fieldErrors.vmid && <p className="text-xs text-red-500">{fieldErrors.vmid}</p>}
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="dt-workingDirectory">Working Directory</Label>
          <Input
            id="dt-workingDirectory"
            value={form.workingDirectory}
            onChange={set('workingDirectory')}
            placeholder="/opt/app"
            className={`font-mono ${fieldErrors.workingDirectory ? 'border-red-500' : ''}`}
          />
          {fieldErrors.workingDirectory && <p className="text-xs text-red-500">{fieldErrors.workingDirectory}</p>}
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="dt-restartCommand">Restart Command</Label>
          <Input
            id="dt-restartCommand"
            value={form.restartCommand}
            onChange={set('restartCommand')}
            placeholder="systemctl restart myapp"
            className={`font-mono ${fieldErrors.restartCommand ? 'border-red-500' : ''}`}
          />
          {fieldErrors.restartCommand && <p className="text-xs text-red-500">{fieldErrors.restartCommand}</p>}
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="dt-preDeployCommand">
            Pre-deploy Command <span className="text-zinc-400">(optional)</span>
          </Label>
          <Input
            id="dt-preDeployCommand"
            value={form.preDeployCommand}
            onChange={set('preDeployCommand')}
            placeholder="npm ci"
            className="font-mono"
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="dt-postDeployCommand">
            Post-deploy Command <span className="text-zinc-400">(optional)</span>
          </Label>
          <Input
            id="dt-postDeployCommand"
            value={form.postDeployCommand}
            onChange={set('postDeployCommand')}
            placeholder="npm run migrate"
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dt-timeoutSeconds">Timeout (seconds)</Label>
          <Input
            id="dt-timeoutSeconds"
            type="number"
            value={form.timeoutSeconds}
            onChange={set('timeoutSeconds')}
            min={10}
            max={3600}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creating…' : 'Create target'}
        </Button>
      </div>
    </form>
  )
}
