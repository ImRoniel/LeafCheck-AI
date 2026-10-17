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

export interface AdminChallenge {
  challengeToken: string
  maskedEmail: string
  expiresAt: number
  resendAvailableAt: number
}

export type LoginResult = { status: 'authenticated' } | { status: 'otp_required' }

export function readChallengeTiming(value: unknown): Pick<AdminChallenge, 'expiresAt' | 'resendAvailableAt'> {
  if (!isRecord(value) || value.status !== 'otp_required' || typeof value.expiresAt !== 'string') {
    throw new Error('Invalid sign-in challenge response. Please sign in again.')
  }
  const expiresAt = Date.parse(value.expiresAt)
  const resendAfter = value.resendAfter ?? 60
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
    typeof resendAfter !== 'number' || !Number.isFinite(resendAfter) || resendAfter < 0) {
    throw new Error('Invalid sign-in challenge response. Please sign in again.')
  }
  return { expiresAt, resendAvailableAt: Date.now() + Math.max(60, resendAfter) * 1000 }
}

export function readAdminChallenge(value: unknown): AdminChallenge {
  if (!isRecord(value) || typeof value.challengeToken !== 'string' || !value.challengeToken.trim() ||
    typeof value.maskedEmail !== 'string' || !value.maskedEmail.trim()) {
    throw new Error('Invalid sign-in challenge response. Please sign in again.')
  }
  return { challengeToken: value.challengeToken, maskedEmail: value.maskedEmail, ...readChallengeTiming(value) }
}

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
