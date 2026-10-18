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
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { ProvisioningPage } from './pages/ProvisioningPage'
import { SettingsPage } from './pages/SettingsPage'
import { IntegrationsPage } from './pages/IntegrationsPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'

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
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequireAuth permission="devices.read" />}>
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
          </Route>
          <Route path="/forbidden" element={<ForbiddenPage />} />
          <Route element={<RequireAuth permission="users.read" />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
          <Route element={<RequireAuth permission="audit.read" />}>
            <Route path="/audit" element={<AuditPage />} />
          </Route>
          <Route element={<RequireAuth permission="devices.provision" />}>
            <Route path="/provisioning" element={<ProvisioningPage />} />
          </Route>
          <Route element={<RequireAuth permission="settings.read" />}>
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route element={<RequireAuth permission="integrations.read" />}>
            <Route path="/integrations" element={<IntegrationsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={user ? '/dashboard' : status === 'otp_required' ? '/login/otp' : '/login'} replace />} />
    </Routes>
  )
}
