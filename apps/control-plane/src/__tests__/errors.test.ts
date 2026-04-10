import { describe, it, expect } from 'vitest'
import { AppError } from '../errors.js'

describe('AppError', () => {
  it('is an instance of Error', () => {
    const err = AppError.internal()
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(AppError)
    expect(err.name).toBe('AppError')
  })

  it('unauthorized() — 401 UNAUTHORIZED', () => {
    const err = AppError.unauthorized()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
    expect(err.message).toBe('Unauthorized')
  })

  it('unauthorized() accepts a custom message', () => {
    const err = AppError.unauthorized('Token expired')
    expect(err.message).toBe('Token expired')
  })

  it('forbidden() — 403 FORBIDDEN', () => {
    const err = AppError.forbidden()
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('FORBIDDEN')
  })

  it('notFound() — 404 with resource name in message', () => {
    const err = AppError.notFound('Node')
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Node not found')
  })

  it('conflict() — 409 CONFLICT', () => {
    const err = AppError.conflict('Already exists')
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('CONFLICT')
    expect(err.message).toBe('Already exists')
  })

  it('internal() — 500 INTERNAL_ERROR', () => {
    const err = AppError.internal()
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('INTERNAL_ERROR')
    expect(err.message).toBe('Internal server error')
  })

  it('internal() accepts a custom message', () => {
    const err = AppError.internal('Something broke')
    expect(err.message).toBe('Something broke')
  })

  it('proxmoxError() — 502 PROXMOX_ERROR', () => {
    const err = AppError.proxmoxError('Connection refused')
    expect(err.statusCode).toBe(502)
    expect(err.code).toBe('PROXMOX_ERROR')
    expect(err.message).toBe('Connection refused')
  })

  it('agentOffline() — 503 AGENT_OFFLINE with vmid in message', () => {
    const err = AppError.agentOffline(100)
    expect(err.statusCode).toBe(503)
    expect(err.code).toBe('AGENT_OFFLINE')
    expect(err.message).toContain('100')
  })

  it('agentBusy() — 409 AGENT_BUSY with vmid in message', () => {
    const err = AppError.agentBusy(200)
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('AGENT_BUSY')
    expect(err.message).toContain('200')
  })

  it('deployInProgress() — 409 DEPLOY_IN_PROGRESS with targetId in message', () => {
    const err = AppError.deployInProgress('target-abc-123')
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('DEPLOY_IN_PROGRESS')
    expect(err.message).toContain('target-abc-123')
  })

  it('webhookInvalidSignature() — 401 WEBHOOK_INVALID_SIGNATURE', () => {
    const err = AppError.webhookInvalidSignature()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe('WEBHOOK_INVALID_SIGNATURE')
  })

  it('rateLimited() — 429 RATE_LIMITED', () => {
    const err = AppError.rateLimited()
    expect(err.statusCode).toBe(429)
    expect(err.code).toBe('RATE_LIMITED')
  })

  it('validationError() — 422 VALIDATION_ERROR with details', () => {
    const details = [{ path: ['username'], message: 'Required' }]
    const err = AppError.validationError('Invalid request', details)
    expect(err.statusCode).toBe(422)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual(details)
  })

  it('validationError() details are attached correctly for nested paths', () => {
    const details = [{ path: ['user', 'address', 'zip'], message: 'Invalid postal code' }]
    const err = AppError.validationError('Validation failed', details)
    expect(err.details?.[0]?.path).toEqual(['user', 'address', 'zip'])
  })
})
