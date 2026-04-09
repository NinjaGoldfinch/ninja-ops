import { sessionManager } from '../session.js'

export function handleSubscribeDeploy(connectionId: string, jobId: string): void {
  sessionManager.subscribeDeploy(connectionId, jobId)
}

export function handleUnsubscribeDeploy(connectionId: string, jobId: string): void {
  sessionManager.unsubscribeDeploy(connectionId, jobId)
}
