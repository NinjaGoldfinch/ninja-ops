import type { ApiError } from '@ninja/types'
import { useAuthStore } from '@/stores/auth'

const BASE = import.meta.env.VITE_API_URL ?? ''

class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { token, logout } = useAuthStore.getState()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : null,
  })

  if (response.status === 401) {
    logout()
    throw new ApiRequestError('UNAUTHORIZED', 'Session expired')
  }

  if (response.status === 204) {
    return undefined as T
  }

  const data = (await response.json()) as { ok: boolean; data?: T } & ApiError

  if (!response.ok || !data.ok) {
    throw new ApiRequestError(
      data.code ?? 'INTERNAL_ERROR',
      data.message ?? 'An unexpected error occurred',
      data.details,
    )
  }

  return (data as { ok: true; data: T }).data
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export { ApiRequestError }
