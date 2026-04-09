import { Queue, Worker } from 'bullmq'
import { redis } from '../db/redis.js'
import { deployService } from '../services/deploy.js'
import { agentService } from '../services/agent.js'
import { sessionManager } from '../ws/session.js'

export const DEPLOY_QUEUE_NAME = 'deploy'

let deployQueue: Queue | null = null
let deployWorker: Worker | null = null

export function getDeployQueue(): Queue {
  if (!deployQueue) throw new Error('Deploy queue not initialized — call startWorkers() first')
  return deployQueue
}

export async function startDeployWorker(): Promise<void> {
  const connection = redis

  deployQueue = new Queue(DEPLOY_QUEUE_NAME, { connection })

  deployWorker = new Worker(
    DEPLOY_QUEUE_NAME,
    async (job) => {
      const { jobId } = job.data as { jobId: string }
      const deployJob = await deployService.getJob(jobId)
      const target = await deployService.getTarget(deployJob.targetId)

      // Find a connected, idle agent for this target
      const agent = await agentService.getAgentForVmid(target.nodeId, target.vmid)

      if (!agent) {
        await deployService.transitionState(jobId, 'failed', {
          errorMessage: `No agent registered for ${target.nodeId}:${target.vmid}`,
        })
        void deployService.getJob(jobId).then(j => sessionManager.broadcastDeployUpdate(jobId, j))
        return
      }

      if (!agentService.isConnected(agent.id)) {
        await deployService.transitionState(jobId, 'failed', {
          errorMessage: `Agent ${agent.id} is offline`,
        })
        void deployService.getJob(jobId).then(j => sessionManager.broadcastDeployUpdate(jobId, j))
        return
      }

      // Determine the commit SHA from the trigger
      let commitSha = '0'.repeat(40)
      const trigger = deployJob.trigger
      if (trigger.source === 'github_webhook') {
        commitSha = trigger.commitSha
      }

      // Dispatch to agent
      await deployService.transitionState(jobId, 'dispatched', { agentId: agent.id })
      void deployService.getJob(jobId).then(j => sessionManager.broadcastDeployUpdate(jobId, j))

      agentService.sendCommand(agent.id, {
        type: 'deploy',
        jobId,
        workingDir: target.workingDir,
        restartCommand: target.restartCommand,
        ...(target.preDeployCommand !== undefined ? { preDeployCommand: target.preDeployCommand } : {}),
        ...(target.postDeployCommand !== undefined ? { postDeployCommand: target.postDeployCommand } : {}),
        timeoutSeconds: target.timeoutSeconds,
        commitSha,
      })
    },
    { connection },
  )

  deployWorker.on('failed', (job, err) => {
    console.error(`[deploy-runner] Job ${job?.id ?? 'unknown'} failed:`, err.message)
  })
}

export async function stopDeployWorker(): Promise<void> {
  await deployWorker?.close()
  await deployQueue?.close()
}
