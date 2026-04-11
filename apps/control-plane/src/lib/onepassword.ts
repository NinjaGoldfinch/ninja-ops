/**
 * 1Password secret reference resolver.
 *
 * Supports op:// secret references (e.g. "op://vault/item/field").
 * Resolution uses the 1Password CLI (`op`) with OP_SERVICE_ACCOUNT_TOKEN.
 *
 * Usage:
 *   - Store an op:// reference as the sshPrivateKey value on a node
 *   - The control-plane resolves it at SSH connection time — the actual key
 *     never touches the database
 *
 * Setup:
 *   1. Create a 1Password service account at https://developer.1password.com/docs/service-accounts/
 *   2. Set OP_SERVICE_ACCOUNT_TOKEN in env/control-plane.env
 *   3. The `op` CLI must be installed on the control-plane host
 *      Install: https://developer.1password.com/docs/cli/get-started/
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.js'

const execFileAsync = promisify(execFile)

const OP_REFERENCE_RE = /^op:\/\//

/** Returns true if the value is a 1Password secret reference. */
export function isOpReference(value: string): boolean {
  return OP_REFERENCE_RE.test(value)
}

/**
 * Resolves a value that may be an op:// secret reference.
 * - If value starts with op://, calls `op read <reference>` and returns stdout.
 * - Otherwise returns the value unchanged.
 *
 * Throws if:
 *   - OP_SERVICE_ACCOUNT_TOKEN is not set
 *   - The `op` CLI is not installed
 *   - The reference cannot be resolved (vault/item not found, no permission)
 */
export async function resolveSecret(value: string): Promise<string> {
  // Strip surrounding quotes that users may paste from a terminal or docs
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  if (!isOpReference(trimmed)) return trimmed

  if (!config.OP_SERVICE_ACCOUNT_TOKEN) {
    throw new Error(
      'op:// secret reference found but OP_SERVICE_ACCOUNT_TOKEN is not set. ' +
      'Create a 1Password service account and add the token to env/control-plane.env.',
    )
  }

  try {
    const { stdout } = await execFileAsync('op', ['read', '--no-newline', trimmed], {
      env: {
        ...process.env,
        OP_SERVICE_ACCOUNT_TOKEN: config.OP_SERVICE_ACCOUNT_TOKEN,
      },
      timeout: 10_000,
    })
    return stdout
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Check for common failure modes and surface a clearer error
    if (msg.includes('command not found') || msg.includes('ENOENT')) {
      throw new Error(
        'The `op` CLI is not installed. Install it from https://developer.1password.com/docs/cli/get-started/',
      )
    }
    throw new Error(`Failed to resolve 1Password secret reference "${trimmed}": ${msg}`)
  }
}
