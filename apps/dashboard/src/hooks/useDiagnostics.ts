import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'

export interface StoredLogEntry {
  id: string
  sessionId: string
  jobType: string
  jobId: string
  stream: 'stdout' | 'stderr'
  data: string
  ts: number
  createdAt: string
}

export interface JobSession {
  sessionId: string
  createdAt: string
}

export function useJobSessionLogs(sessionId: string | null, live = false) {
  return useQuery({
    queryKey: ['job-logs', 'session', sessionId],
    queryFn: () => api.get<StoredLogEntry[]>(`/api/diagnostics/logs/${sessionId!}`),
    enabled: !!sessionId,
    refetchInterval: live ? 1500 : false,
  })
}

export function useJobSessions(jobType: string, jobId: string | null, live = false) {
  return useQuery({
    queryKey: ['job-logs', 'job', jobType, jobId],
    queryFn: () => api.get<JobSession[]>(`/api/diagnostics/logs/job/${jobType}/${encodeURIComponent(jobId!)}`),
    enabled: !!jobId,
    refetchInterval: live ? 3000 : false,
  })
}

export { useControlLogsStore } from '@/stores/controlLogs'
export type { ControlLogLine } from '@/stores/controlLogs'

interface NodeHealthResult {
  id: string
  name: string
  api: 'ok' | 'error'
  ssh: 'ok' | 'error' | 'unconfigured'
}

export interface SystemHealth {
  db: 'ok' | 'error'
  redis: 'ok' | 'error'
  nodes: NodeHealthResult[]
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['diagnostics', 'health'],
    queryFn: () => api.get<SystemHealth>('/api/diagnostics/health'),
    enabled: false,
    retry: false,
  })
}

export interface SshTestResult {
  connected: boolean
  host: string
  latencyMs: number
}

export function useTestSsh() {
  return useMutation({
    mutationFn: (nodeId: string) =>
      api.post<SshTestResult>('/api/diagnostics/test-ssh', { nodeId }),
  })
}

export interface ExecLine {
  stream: 'stdout' | 'stderr' | 'info'
  data: string
  ts: number
}

export function useDiagnosticExec() {
  const linesRef = useRef<ExecLine[]>([])
  const [, setTick] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [execError, setExecError] = useState<string | null>(null)
  const activeRequestId = useRef<string | null>(null)

  useEffect(() => {
    const unsubOutput = ws.on('diagnostic_output', (msg) => {
      if (msg.type !== 'diagnostic_output') return
      if (msg.requestId !== activeRequestId.current) return
      linesRef.current = [...linesRef.current, { stream: msg.stream, data: msg.data, ts: Date.now() }]
      setTick((t) => t + 1)
    })

    const unsubDone = ws.on('diagnostic_done', (msg) => {
      if (msg.type !== 'diagnostic_done') return
      if (msg.requestId !== activeRequestId.current) return
      activeRequestId.current = null
      setIsRunning(false)
      setExitCode(msg.exitCode)
      if (msg.error) {
        setExecError(msg.error)
        linesRef.current = [...linesRef.current, { stream: 'stderr', data: `Error: ${msg.error}\n`, ts: Date.now() }]
        setTick((t) => t + 1)
      }
    })

    return () => {
      unsubOutput()
      unsubDone()
    }
  }, [])

  const execute = useCallback((nodeId: string, vmid: number, command: string[]) => {
    const requestId = crypto.randomUUID()
    linesRef.current = []
    activeRequestId.current = requestId
    setIsRunning(true)
    setExitCode(null)
    setExecError(null)
    setTick(0)

    ws.send({ type: 'diagnostic_exec', requestId, nodeId, vmid, command })
  }, [])

  const clear = useCallback(() => {
    linesRef.current = []
    activeRequestId.current = null
    setIsRunning(false)
    setExitCode(null)
    setExecError(null)
    setTick(0)
  }, [])

  return {
    lines: linesRef.current,
    isRunning,
    exitCode,
    error: execError,
    execute,
    clear,
  }
}
