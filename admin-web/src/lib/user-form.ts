import { ApiError } from './api'

export type UserField = 'name' | 'email' | 'password' | 'role'
export type UserFieldErrors = Partial<Record<UserField, string>>

export function validateUserForm(data: { name: string; role: string; email?: string; password?: string }): UserFieldErrors {
  const errors: UserFieldErrors = {}
  if (data.name.length > 100) errors.name = 'Name must contain at most 100 characters.'
  if (!['USER', 'LEAD_DEV', 'ADMIN'].includes(data.role)) errors.role = 'Choose a valid account role.'
  if (data.email !== undefined && (data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()))) {
    errors.email = 'Enter a valid email address (up to 254 characters).'
  }
  if (data.password !== undefined && ([...data.password].length < 8 || [...data.password].length > 128)) {
    errors.password = 'Password must contain 8–128 characters.'
  }
  return errors
}

export function userFieldErrors(error: unknown): UserFieldErrors {
  if (!(error instanceof ApiError)) return {}
  const fields: UserFieldErrors = {}
  for (const key of ['name', 'email', 'password', 'role'] as const) {
    if (error.fieldErrors[key]) fields[key] = error.fieldErrors[key]
  }
  if (Object.keys(fields).length) return fields
  // Compatibility with older backend responses that do not include fieldErrors.
  if (error.code === 'EMAIL_CONFLICT' || error.code === 'INVALID_EMAIL') fields.email = error.message
  else if (error.code === 'WEAK_PASSWORD' || ([400, 422].includes(error.status) && /password.*weak|weak.*password/i.test(error.message))) fields.password = error.message
  return fields
}
