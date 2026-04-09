import { z } from 'zod'

// ── Roles ────────────────────────────────────────────────────────────────

export const ROLES = ['admin', 'operator', 'viewer'] as const
export const RoleSchema = z.enum(ROLES)
export type Role = z.infer<typeof RoleSchema>

// ── User ─────────────────────────────────────────────────────────────────

export const UserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(64),
  role: RoleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type User = z.infer<typeof UserSchema>

// ── JWT payload ───────────────────────────────────────────────────────────
// What is encoded inside the JWT. Keep it small.

export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),       // user id
  username: z.string(),
  role: RoleSchema,
  iat: z.number(),
  exp: z.number(),
})
export type JwtPayload = z.infer<typeof JwtPayloadSchema>

// ── Login request / response ──────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

export const LoginResponseSchema = z.object({
  token: z.string(),
  user: UserSchema.omit({ createdAt: true, updatedAt: true }),
})
export type LoginResponse = z.infer<typeof LoginResponseSchema>

// ── Change password ───────────────────────────────────────────────────────

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
})
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>
