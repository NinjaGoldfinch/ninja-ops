import { createRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { layoutRoute } from '@/layout-route'
import { useCreateDeployTarget } from '@/hooks/useDeploy'
import { useNodes } from '@/hooks/useNodes'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ApiRequestError } from '@/lib/api'
import { ArrowLeft } from 'lucide-react'

export const newTargetRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/deploy/targets/new',
  component: NewTargetPage,
})

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

function NewTargetPage() {
  const navigate = useNavigate()
  const { data: nodes } = useNodes()
  const { mutate: create, isPending } = useCreateDeployTarget()
  const { toast } = useToast()

  const [form, setForm] = useState<FormState>({
    repository: '',
    branch: 'main',
    nodeId: '',
    vmid: '',
    workingDirectory: '/opt/app',
    restartCommand: '',
    preDeployCommand: '',
    postDeployCommand: '',
    timeoutSeconds: '300',
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
      setFieldErrors((fe) => ({ ...fe, [field]: undefined }))
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Client-side validation
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
          void navigate({ to: '/deploy' })
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
    <div className="max-w-2xl">
      <div className="mb-6">
        <button
          onClick={() => void navigate({ to: '/deploy' })}
          className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 mb-4"
        >
          <ArrowLeft size={14} />
          Back to targets
        </button>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">New Deploy Target</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Map a GitHub repository branch to a container for automated deploys.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="repository">Repository</Label>
            <Input
              id="repository"
              value={form.repository}
              onChange={set('repository')}
              placeholder="owner/repo-name"
              className={fieldErrors.repository ? 'border-red-500' : ''}
            />
            {fieldErrors.repository && (
              <p className="text-xs text-red-500">{fieldErrors.repository}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="branch">Branch</Label>
            <Input
              id="branch"
              value={form.branch}
              onChange={set('branch')}
              className={fieldErrors.branch ? 'border-red-500' : ''}
            />
            {fieldErrors.branch && (
              <p className="text-xs text-red-500">{fieldErrors.branch}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nodeId">Node</Label>
            <Select
              id="nodeId"
              value={form.nodeId}
              onChange={set('nodeId')}
              className={fieldErrors.nodeId ? 'border-red-500' : ''}
            >
              <option value="">Select a node…</option>
              {nodes?.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </Select>
            {fieldErrors.nodeId && (
              <p className="text-xs text-red-500">{fieldErrors.nodeId}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="vmid">Container VMID</Label>
            <Input
              id="vmid"
              type="number"
              value={form.vmid}
              onChange={set('vmid')}
              placeholder="100"
              className={fieldErrors.vmid ? 'border-red-500' : ''}
            />
            {fieldErrors.vmid && (
              <p className="text-xs text-red-500">{fieldErrors.vmid}</p>
            )}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="workingDirectory">Working Directory</Label>
            <Input
              id="workingDirectory"
              value={form.workingDirectory}
              onChange={set('workingDirectory')}
              placeholder="/opt/app"
              className={fieldErrors.workingDirectory ? 'border-red-500' : ''}
            />
            {fieldErrors.workingDirectory && (
              <p className="text-xs text-red-500">{fieldErrors.workingDirectory}</p>
            )}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="restartCommand">Restart Command</Label>
            <Input
              id="restartCommand"
              value={form.restartCommand}
              onChange={set('restartCommand')}
              placeholder="systemctl restart myapp"
              className={`font-mono ${fieldErrors.restartCommand ? 'border-red-500' : ''}`}
            />
            {fieldErrors.restartCommand && (
              <p className="text-xs text-red-500">{fieldErrors.restartCommand}</p>
            )}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="preDeployCommand">Pre-deploy Command <span className="text-zinc-400">(optional)</span></Label>
            <Input
              id="preDeployCommand"
              value={form.preDeployCommand}
              onChange={set('preDeployCommand')}
              placeholder="npm ci"
              className="font-mono"
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="postDeployCommand">Post-deploy Command <span className="text-zinc-400">(optional)</span></Label>
            <Input
              id="postDeployCommand"
              value={form.postDeployCommand}
              onChange={set('postDeployCommand')}
              placeholder="npm run migrate"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timeoutSeconds">Timeout (seconds)</Label>
            <Input
              id="timeoutSeconds"
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
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigate({ to: '/deploy' })}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
