import { Navigate, Outlet } from 'react-router-dom'
import { useSession } from '../context/session'
import { SessionLoading } from './SessionLoading'
import { hasPermission, type Permission } from '../lib/permissions'

export function RequireAuth({ permission }: { permission?: Permission }) {
  const { user, status } = useSession()
  if (status === 'restoring' || status === 'authenticating' || status === 'signingOut') {
    return <SessionLoading />
  }
  if (!user || (user.role !== 'ADMIN' && user.role !== 'LEAD_DEV')) {
    return <Navigate to={status === 'otp_required' ? '/login/otp' : '/login'} replace />
  }
  if (permission && !hasPermission(user.role, permission)) return <Navigate to="/forbidden" replace />
  return <Outlet />
}
