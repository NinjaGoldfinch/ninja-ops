import { Button } from '@/components/ui/button'
import { useRedeployService } from '@/hooks/useServiceRedeploy'
import { useToast } from '@/components/ui/toast'
import type { ServiceVersion, ServiceRedeployJob, ServiceName } from '@ninja/types'
import { cn } from '@/lib/utils'
import { RefreshCw, CheckCircle, ArrowUpCircle, Loader2 } from 'lucide-react'

interface ServiceVersionCardProps {
  version: ServiceVersion
  activeJob: ServiceRedeployJob | undefined
  onJobCreated: (jobId: string) => void
}

export function ServiceVersionCard({ version, activeJob, onJobCreated }: ServiceVersionCardProps) {
  const { mutate: redeployService, isPending } = useRedeployService()
  const { toast } = useToast()

  const isDeploying = activeJob?.state === 'queued' || activeJob?.state === 'running'

  const handleDeploy = () => {
    redeployService({ service: version.service as ServiceName }, {
      onSuccess: (job) => {
        onJobCreated(job.id)
        toast({ title: `${version.service} redeploy queued`, variant: 'success' })
      },
      onError: (err) => toast({ title: 'Redeploy failed', description: String(err), variant: 'error' }),
    })
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-mono">
          {version.service}
        </h3>
        {version.updateAvailable ? (
          <span className="inline-flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
            <ArrowUpCircle size={12} />
            Update available
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle size={12} />
            Up to date
          </span>
        )}
      </div>

      <div className="rounded border border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-zinc-500">Current</span>
          <span className="font-mono text-zinc-400">v{version.current}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-zinc-500">Latest</span>
          <span className={cn(
            'font-mono',
            version.updateAvailable ? 'text-yellow-500 dark:text-yellow-400' : 'text-zinc-400',
          )}>
            v{version.latest}
          </span>
        </div>
      </div>

      {activeJob && (
        <div className={cn(
          'rounded px-3 py-2 text-xs',
          activeJob.state === 'running' ? 'bg-blue-900/30 text-blue-400' :
          activeJob.state === 'queued'  ? 'bg-zinc-800/60 text-zinc-400' :
          activeJob.state === 'success' ? 'bg-green-900/30 text-green-400' :
          'bg-red-900/30 text-red-400',
        )}>
          {activeJob.state === 'running' && <Loader2 size={10} className="inline animate-spin mr-1" />}
          {activeJob.state.charAt(0).toUpperCase() + activeJob.state.slice(1)}
          {activeJob.targetVersion && <span className="text-zinc-500 ml-1">→ v{activeJob.targetVersion.replace(/^v/, '')}</span>}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={handleDeploy}
        disabled={isPending || isDeploying}
      >
        <RefreshCw size={13} className={cn('mr-1.5', isPending && 'animate-spin')} />
        Deploy latest
      </Button>
    </div>
  )
}
