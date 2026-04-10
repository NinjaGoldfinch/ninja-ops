import { SignJWT } from 'jose'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'

// Sign tokens using the same algorithm and secret the app uses, but directly
// via jose — avoiding potential module-isolation issues with plugins/auth.ts.
function getSecret(): Uint8Array {
  const jwtSecret = process.env['JWT_SECRET']
  if (!jwtSecret) throw new Error('JWT_SECRET not set')
  return new TextEncoder().encode(jwtSecret)
}

export async function makeToken(
  role: 'admin' | 'operator' | 'viewer',
  sub = '00000000-0000-0000-0000-000000000001',
): Promise<string> {
  return new SignJWT({ sub, username: role, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(getSecret())
}

export async function makeApp(): Promise<FastifyInstance> {
  return buildApp()
}

export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` }
}
