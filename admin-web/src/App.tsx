import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './components/AdminLayout'
import { RequireAuth } from './components/RequireAuth'
import { SessionLoading } from './components/SessionLoading'
import { useSession } from './context/session'
import { AuditPage } from './pages/AuditPage'
import { DashboardPage } from './pages/DashboardPage'
import { DevicesPage } from './pages/DevicesPage'
import { LoginPage } from './pages/LoginPage'
import { UsersPage } from './pages/UsersPage'
import { AdminOtpPage } from './pages/AdminOtpPage'
import { ForbiddenPage } from './pages/ForbiddenPage'

export default function App() {
  const { user, status } = useSession()
  if (status === 'restoring') return <SessionLoading />

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/otp" element={<AdminOtpPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AdminLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route element={<RequireAuth permission="users.read" />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
          <Route element={<RequireAuth permission="audit.read" />}>
            <Route path="/audit" element={<AuditPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={user ? '/dashboard' : status === 'otp_required' ? '/login/otp' : '/login'} replace />} />
    </Routes>
  )
}
