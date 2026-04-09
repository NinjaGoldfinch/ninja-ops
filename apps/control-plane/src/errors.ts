import type { ApiErrorCode } from '@ninja/types'

export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: Array<{ path: Array<string | number>; message: string }>,
  ) {
    super(message)
    this.name = 'AppError'
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError('UNAUTHORIZED', message, 401)
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError('FORBIDDEN', message, 403)
  }

  static notFound(resource: string): AppError {
    return new AppError('NOT_FOUND', `${resource} not found`, 404)
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message, 409)
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError('INTERNAL_ERROR', message, 500)
  }

  static proxmoxError(message: string): AppError {
    return new AppError('PROXMOX_ERROR', message, 502)
  }

  static agentOffline(vmid: number): AppError {
    return new AppError('AGENT_OFFLINE', `No agent connected for container ${vmid}`, 503)
  }

  static agentBusy(vmid: number): AppError {
    return new AppError('AGENT_BUSY', `Agent for container ${vmid} is currently busy`, 409)
  }

  static deployInProgress(targetId: string): AppError {
    return new AppError('DEPLOY_IN_PROGRESS', `A deploy is already running for target ${targetId}`, 409)
  }

  static webhookInvalidSignature(): AppError {
    return new AppError('WEBHOOK_INVALID_SIGNATURE', 'Invalid webhook signature', 401)
  }

  static rateLimited(): AppError {
    return new AppError('RATE_LIMITED', 'Too many requests', 429)
  }

  static validationError(
    message: string,
    details: Array<{ path: Array<string | number>; message: string }>,
  ): AppError {
    return new AppError('VALIDATION_ERROR', message, 422, details)
  }
}
