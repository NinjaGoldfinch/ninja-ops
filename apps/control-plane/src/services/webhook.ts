import { createHmac, timingSafeEqual } from 'node:crypto'
import { GithubWorkflowRunPayloadSchema } from '@ninja/types'
import { deployService } from './deploy.js'
import { config } from '../config.js'
import { AppError } from '../errors.js'
import { getDeployQueue } from '../workers/deploy-runner.js'

export class WebhookService {
  verifyGithubSignature(body: Buffer, signatureHeader: string): void {
    const expected = `sha256=${createHmac('sha256', config.GITHUB_WEBHOOK_SECRET)
      .update(body)
      .digest('hex')}`

    const expectedBuf = Buffer.from(expected)
    const actualBuf = Buffer.from(signatureHeader)

    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw AppError.webhookInvalidSignature()
    }
  }

  async handleGithubWorkflowRun(rawBody: Buffer): Promise<{ triggered: boolean }> {
    const json = JSON.parse(rawBody.toString('utf8')) as unknown
    const result = GithubWorkflowRunPayloadSchema.safeParse(json)

    if (!result.success) {
      // Unknown payload shape — ignore silently
      return { triggered: false }
    }

    const payload = result.data

    // Only act on completed + success runs
    if (payload.action !== 'completed' || payload.workflow_run.conclusion !== 'success') {
      return { triggered: false }
    }

    const repo = payload.workflow_run.repository.full_name
    const branch = payload.workflow_run.head_branch

    const target = await deployService.findTargetByRepoBranch(repo, branch)
    if (!target) {
      return { triggered: false }
    }

    const job = await deployService.triggerDeploy(target.id, {
      source: 'github_webhook',
      repository: repo,
      branch,
      commitSha: payload.workflow_run.head_sha,
      ...(payload.workflow_run.triggering_actor.login
        ? { actor: payload.workflow_run.triggering_actor.login }
        : {}),
      workflowRunId: payload.workflow_run.id,
    })

    await getDeployQueue().add('deploy', { jobId: job.id })

    return { triggered: true }
  }
}

export const webhookService = new WebhookService()
