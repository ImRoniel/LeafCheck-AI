import { createContext, useContext } from 'react'
import type { AdminRole, AdminUser } from '../lib/auth'

export type { AdminRole, AdminUser } from '../lib/auth'
export type SessionStatus = 'restoring' | 'anonymous' | 'authenticating' | 'authenticated' | 'signingOut'

export const roleLabels: Record<AdminRole, string> = {
  ADMIN: 'SuperAdmin',
  LEAD_DEV: 'Lead_Dev',
}

interface SessionContextValue {
  user: AdminUser | null
  status: SessionStatus
  sessionError: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  restoreSession: () => Promise<void>
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used within SessionProvider.')
  return session
}
