import { LogAgentRegisterResponseSchema } from '@ninja/types'
import { config } from './config.js'
import { log } from './logger.js'

async function attempt(): Promise<{ agentId: string; token: string } | null> {
  try {
    const res = await fetch(`${config.CONTROL_PLANE_URL}/api/log-agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId:     config.NODE_ID,
        vmid:       config.VMID,
        bundleHash: config.AGENT_BUNDLE_HASH,
        secret:     config.AGENT_SECRET,
        hostname:   config.HOSTNAME,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      log.warn('Registration failed', { status: res.status, body: text })
      return null
    }

    const json = (await res.json()) as unknown
    const envelope = json as { ok: boolean; data: unknown }
    const parsed = LogAgentRegisterResponseSchema.safeParse(envelope.data)
    if (!parsed.success) {
      log.warn('Registration response parse failed', { issues: parsed.error.issues })
      return null
    }

    return parsed.data
  } catch (err) {
    log.warn('Registration request error', { error: String(err) })
    return null
  }
}

export async function register(): Promise<{ agentId: string; token: string }> {
  const delays = [1_000, 2_000, 4_000, 8_000]
  const cap = 30_000
  let attempt_count = 0

  while (true) {
    const result = await attempt()
    if (result !== null) {
      return result
    }

    const delay = Math.min(delays[attempt_count] ?? cap, cap)
    attempt_count++
    log.info('Retrying registration', { delayMs: delay, attempt: attempt_count })
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}
