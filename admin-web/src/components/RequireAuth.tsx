import { Navigate, Outlet } from 'react-router-dom'
import { useSession } from '../context/session'
import { SessionLoading } from './SessionLoading'

export function RequireAuth() {
  const { user, status } = useSession()
  if (status === 'restoring' || status === 'authenticating' || status === 'signingOut') {
    return <SessionLoading />
  }
  if (!user || (user.role !== 'ADMIN' && user.role !== 'LEAD_DEV')) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
