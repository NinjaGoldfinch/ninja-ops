import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import type { TestApp } from '../helpers.js'
import { makeApp, makeToken, authHeader } from '../helpers.js'
import { AppError } from '../../errors.js'

vi.mock('../../services/auth.js', () => ({
  authService: {
    login: vi.fn(),
    changePassword: vi.fn(),
  },
}))

import { authService } from '../../services/auth.js'

const loginMock = vi.mocked(authService.login)
const changePwdMock = vi.mocked(authService.changePassword)

let app: TestApp

beforeAll(async () => {
  app = await makeApp()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/auth/login', () => {
  it('returns 200 with token and user on valid credentials', async () => {
    loginMock.mockResolvedValue({
      token: 'signed-jwt',
      user: { id: 'user-1', username: 'admin', role: 'admin' },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'changeme123!' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; data: { token: string } }
    expect(body.ok).toBe(true)
    expect(body.data.token).toBe('signed-jwt')
    expect(loginMock).toHaveBeenCalledWith('admin', 'changeme123!')
  })

  it('returns 401 when authService throws unauthorized', async () => {
    loginMock.mockRejectedValue(AppError.unauthorized('Invalid username or password'))

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    })

    expect(res.statusCode).toBe(401)
    const body = JSON.parse(res.body) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('returns 422 when body is missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin' }, // missing password
    })

    expect(res.statusCode).toBe(422)
    const body = JSON.parse(res.body) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('returns 422 when body is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    })

    expect(res.statusCode).toBe(422)
  })
})

describe('PUT /api/auth/password', () => {
  it('returns 200 on successful password change', async () => {
    const token = await makeToken('admin')
    changePwdMock.mockResolvedValue(undefined)

    const res = await app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      headers: authHeader(token),
      payload: { currentPassword: 'oldpass', newPassword: 'newpass123!XYZ' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(changePwdMock).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', 'oldpass', 'newpass123!XYZ')
  })

  it('returns 401 when no auth token is provided', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      payload: { currentPassword: 'oldpass', newPassword: 'newpass123!' },
    })

    expect(res.statusCode).toBe(401)
    expect(changePwdMock).not.toHaveBeenCalled()
  })

  it('returns 401 when authService throws unauthorized (wrong current password)', async () => {
    const token = await makeToken('viewer')
    changePwdMock.mockRejectedValue(AppError.unauthorized('Current password is incorrect'))

    const res = await app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      headers: authHeader(token),
      payload: { currentPassword: 'wrong', newPassword: 'newpassword123!' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 422 when body is missing required fields', async () => {
    const token = await makeToken('admin')

    const res = await app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      headers: authHeader(token),
      payload: { currentPassword: 'oldpass' }, // missing newPassword
    })

    expect(res.statusCode).toBe(422)
  })
})
