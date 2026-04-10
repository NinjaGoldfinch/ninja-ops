import { spawn } from 'node:child_process'
import type { AgentCommand, AgentResult } from '@ninja/types'
import { log } from './logger.js'
import { send, setCurrentJobId } from './connection.js'

let activeAbortController: AbortController | null = null
let activeJobId: string | null = null
let globalTimeoutHandle: NodeJS.Timeout | null = null
let agentIdRef = ''

// monotonically increasing sequence number per deploy job
let seq = 0

function sendResult(payload: AgentResult): void {
  send({ type: 'result', payload })
}

function sendLog(jobId: string, stream: 'stdout' | 'stderr', line: string): void {
  const trimmed = line.trim()
  if (trimmed === '') return
  sendResult({
    type: 'deploy_log',
    jobId,
    seq: seq++,
    stream,
    line: trimmed,
    timestamp: new Date().toISOString(),
  })
}

function runCommand(
  cmd: string,
  cwd: string,
  jobId: string,
  signal: AbortSignal,
): Promise<number> {
  return new Promise(resolve => {
    const child = spawn('sh', ['-c', cmd], { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] })

    let sigkillTimer: NodeJS.Timeout | null = null

    const onAbort = () => {
      child.kill('SIGTERM')
      sigkillTimer = setTimeout(() => {
        child.kill('SIGKILL')
      }, 3_000)
    }

    signal.addEventListener('abort', onAbort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    let stdoutBuffer = ''
    let stderrBuffer = ''

    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        sendLog(jobId, 'stdout', line)
      }
    })

    child.stderr.on('data', (chunk: string) => {
      stderrBuffer += chunk
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop() ?? ''
      for (const line of lines) {
        sendLog(jobId, 'stderr', line)
      }
    })

    child.on('close', (code, sig) => {
      signal.removeEventListener('abort', onAbort)
      if (sigkillTimer !== null) clearTimeout(sigkillTimer)

      // flush remaining buffer
      if (stdoutBuffer.trim() !== '') sendLog(jobId, 'stdout', stdoutBuffer)
      if (stderrBuffer.trim() !== '') sendLog(jobId, 'stderr', stderrBuffer)

      const exitCode = code ?? (sig !== null ? 130 : 1)
      resolve(exitCode)
    })

    child.on('error', err => {
      // AbortError means we killed it intentionally
      if ((err as NodeJS.ErrnoException).code !== 'ABORT_ERR') {
        sendLog(jobId, 'stderr', `spawn error: ${err.message}`)
      }
    })
  })
}

function cleanup(): void {
  if (globalTimeoutHandle !== null) {
    clearTimeout(globalTimeoutHandle)
    globalTimeoutHandle = null
  }
  activeAbortController = null
  activeJobId = null
  setCurrentJobId(null)
}

async function executeDeploy(cmd: Extract<AgentCommand, { type: 'deploy' }>): Promise<void> {
  const { jobId, workingDir, commitSha, preDeployCommand, restartCommand, postDeployCommand, timeoutSeconds } = cmd

  activeJobId = jobId
  seq = 0
  setCurrentJobId(jobId)

  const controller = new AbortController()
  activeAbortController = controller

  globalTimeoutHandle = setTimeout(() => {
    log.warn('Deploy timed out', { jobId, timeoutSeconds })
    controller.abort()
  }, timeoutSeconds * 1_000)

  sendResult({
    type: 'deploy_started',
    jobId,
    agentId: agentIdRef,
    timestamp: new Date().toISOString(),
  })

  const { signal } = controller

  const finish = (exitCode: number) => {
    sendResult({
      type: 'deploy_finished',
      jobId,
      exitCode,
      timestamp: new Date().toISOString(),
    })
    cleanup()
  }

  try {
    // git fetch + reset
    const fetchCode = await runCommand(`git fetch origin && git reset --hard ${commitSha}`, workingDir, jobId, signal)
    if (fetchCode !== 0) { finish(signal.aborted ? 130 : fetchCode); return }

    // pre-deploy
    if (preDeployCommand !== undefined && preDeployCommand !== '') {
      const preCode = await runCommand(preDeployCommand, workingDir, jobId, signal)
      if (preCode !== 0) { finish(signal.aborted ? 130 : preCode); return }
    }

    // restart
    const restartCode = await runCommand(restartCommand, workingDir, jobId, signal)
    if (restartCode !== 0) { finish(signal.aborted ? 130 : restartCode); return }

    // post-deploy
    if (postDeployCommand !== undefined && postDeployCommand !== '') {
      const postCode = await runCommand(postDeployCommand, workingDir, jobId, signal)
      if (postCode !== 0) { finish(signal.aborted ? 130 : postCode); return }
    }

    finish(0)
  } catch (err) {
    log.error('Unexpected deploy error', { jobId, error: String(err) })
    sendResult({
      type: 'deploy_log',
      jobId,
      seq: seq++,
      stream: 'stderr',
      line: `Internal error: ${String(err)}`,
      timestamp: new Date().toISOString(),
    })
    finish(1)
    cleanup()
  }
}

export function handleCommand(cmd: AgentCommand, agentId: string): void {
  agentIdRef = agentId

  if (cmd.type === 'ping') {
    send({
      type: 'result',
      payload: {
        type: 'pong',
        agentId,
        timestamp: new Date().toISOString(),
      },
    })
    return
  }

  if (cmd.type === 'cancel') {
    if (activeJobId !== null && activeAbortController !== null && cmd.jobId === activeJobId) {
      log.info('Cancelling active deploy', { jobId: cmd.jobId })
      activeAbortController.abort()
    }
    return
  }

  if (cmd.type === 'deploy') {
    if (activeJobId !== null) {
      log.warn('Deploy already in progress, rejecting', { incomingJobId: cmd.jobId, activeJobId })
      send({
        type: 'result',
        payload: {
          type: 'deploy_log',
          jobId: cmd.jobId,
          seq: 0,
          stream: 'stderr',
          line: 'Deploy already in progress',
          timestamp: new Date().toISOString(),
        },
      })
      send({
        type: 'result',
        payload: {
          type: 'deploy_finished',
          jobId: cmd.jobId,
          exitCode: 1,
          timestamp: new Date().toISOString(),
        },
      })
      return
    }

    executeDeploy(cmd).catch(err => {
      log.error('Unhandled deploy error', { error: String(err) })
      cleanup()
    })
  }
}

export function cancelActiveDeploy(): void {
  if (activeAbortController !== null) {
    log.info('Cancelling active deploy for shutdown', { jobId: activeJobId })
    activeAbortController.abort()
  }
}
