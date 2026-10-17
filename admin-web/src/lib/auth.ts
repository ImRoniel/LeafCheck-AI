export type AdminRole = 'ADMIN' | 'LEAD_DEV'

export interface AuthUser {
  email: string
  role: AdminRole | 'USER'
  id?: string
  name?: string | null
  createdAt?: string
  updatedAt?: string
}

export type AdminUser = AuthUser & { role: AdminRole }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readAccessToken(value: unknown): string {
  if (!isRecord(value) || typeof value.accessToken !== 'string' || !value.accessToken.trim()) {
    throw new Error('Invalid authentication response.')
  }
  return value.accessToken
}

export function readUser(value: unknown): AuthUser {
  if (!isRecord(value) || typeof value.email !== 'string' || !value.email.trim() ||
    (value.role !== 'ADMIN' && value.role !== 'LEAD_DEV' && value.role !== 'USER')) {
    throw new Error('Invalid user response.')
  }
  for (const key of ['id', 'createdAt', 'updatedAt'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error('Invalid user response.')
    }
  }
  if (value.name !== undefined && value.name !== null && typeof value.name !== 'string') {
    throw new Error('Invalid user response.')
  }
  return { ...value, email: value.email, role: value.role }
}

export function isAdminUser(user: AuthUser): user is AdminUser {
  return user.role === 'ADMIN' || user.role === 'LEAD_DEV'
}
