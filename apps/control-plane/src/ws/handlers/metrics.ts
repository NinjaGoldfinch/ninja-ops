import { sessionManager } from '../session.js'

export function handleSubscribeMetrics(
  connectionId: string,
  nodeId: string,
  vmid: number,
): void {
  sessionManager.subscribeMetrics(connectionId, nodeId, vmid)
}

export function handleUnsubscribeMetrics(
  connectionId: string,
  nodeId: string,
  vmid: number,
): void {
  sessionManager.unsubscribeMetrics(connectionId, nodeId, vmid)
}
