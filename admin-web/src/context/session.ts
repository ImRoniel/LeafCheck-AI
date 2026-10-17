import { createContext, useContext } from 'react'
import type { AdminChallenge, AdminRole, AdminUser, LoginResult } from '../lib/auth'

export type { AdminRole, AdminUser } from '../lib/auth'
export type SessionStatus = 'restoring' | 'anonymous' | 'authenticating' | 'otp_required' | 'authenticated' | 'signingOut'

export const roleLabels: Record<AdminRole, string> = {
  ADMIN: 'SuperAdmin',
  LEAD_DEV: 'System Administrator',
}

interface SessionContextValue {
  user: AdminUser | null
  status: SessionStatus
  sessionError: string | null
  challenge: AdminChallenge | null
  otpBusy: boolean
  login: (email: string, password: string) => Promise<LoginResult>
  verifyAdminOtp: (challengeToken: string, code: string) => Promise<void>
  cancelAdminOtp: () => Promise<void>
  resendAdminOtp: () => Promise<void>
  logout: () => Promise<void>
  restoreSession: () => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used within SessionProvider.')
  return session
}
