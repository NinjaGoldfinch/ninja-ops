import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'
import type { DeployLogLine } from '@ninja/types'

export function useDeployLogs(
  jobId: string,
  isLive: boolean,
): { lines: DeployLogLine[]; isStreaming: boolean } {
  const liveLines = useRef<DeployLogLine[]>([])
  const [, setTick] = useState(0)

  const { data: fetchedLines } = useQuery({
    queryKey: ['deploy-logs', jobId],
    queryFn: () => api.get<DeployLogLine[]>(`/api/deploy/jobs/${jobId}/logs`),
    enabled: !isLive && !!jobId,
  })

  useEffect(() => {
    if (!isLive || !jobId) return

    liveLines.current = []
    ws.send({ type: 'subscribe_deploy', jobId })

    const unsub = ws.on('deploy_log', (msg) => {
      if (msg.type === 'deploy_log' && msg.data.jobId === jobId) {
        liveLines.current = [...liveLines.current, msg.data]
        setTick((t) => t + 1)
      }
    })

    return () => {
      unsub()
      ws.send({ type: 'unsubscribe_deploy', jobId })
    }
  }, [jobId, isLive])

  return {
    lines: isLive ? liveLines.current : (fetchedLines ?? []),
    isStreaming: isLive,
  }
}
