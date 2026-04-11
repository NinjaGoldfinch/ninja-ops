import type { WebSocket } from '@fastify/websocket'
import { nodeService } from '../../services/node.js'
import { proxmoxService } from '../../services/proxmox.js'
import { sessionManager } from '../session.js'

function send(socket: WebSocket, msg: object): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg))
  }
}

export async function handleDiagnosticExec(
  connectionId: string,
  socket: WebSocket,
  msg: { requestId: string; nodeId: string; vmid: number; command: string[] },
): Promise<void> {
  const session = sessionManager.get(connectionId)
  if (!session || session.role !== 'admin') {
    send(socket, {
      type: 'diagnostic_done',
      requestId: msg.requestId,
      exitCode: null,
      error: 'Admin role required',
    })
    return
  }

  let withSecret: Awaited<ReturnType<typeof nodeService.getWithSecret>>
  try {
    withSecret = await nodeService.getWithSecret(msg.nodeId)
  } catch (err) {
    send(socket, {
      type: 'diagnostic_done',
      requestId: msg.requestId,
      exitCode: null,
      error: `Node not found: ${err instanceof Error ? err.message : String(err)}`,
    })
    return
  }

  const cfg = {
    host: withSecret.node.host,
    port: withSecret.node.port,
    tokenId: withSecret.node.tokenId,
    tokenSecret: withSecret.tokenSecret,
    nodeName: withSecret.node.name,
    sshUser: withSecret.node.sshUser,
    sshPassword: withSecret.sshPassword,
    sshHost: withSecret.sshHost,
  }

  send(socket, {
    type: 'diagnostic_output',
    requestId: msg.requestId,
    stream: 'info',
    data: `[ssh] pct exec ${msg.vmid} -- ${msg.command.join(' ')}\n`,
  })

  try {
    const exitCode = await proxmoxService.sshPctExecStreaming(
      cfg,
      msg.vmid,
      msg.command,
      (data) => send(socket, { type: 'diagnostic_output', requestId: msg.requestId, stream: 'stdout', data }),
      (data) => send(socket, { type: 'diagnostic_output', requestId: msg.requestId, stream: 'stderr', data }),
    )
    send(socket, { type: 'diagnostic_done', requestId: msg.requestId, exitCode })
  } catch (err) {
    send(socket, {
      type: 'diagnostic_done',
      requestId: msg.requestId,
      exitCode: null,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
