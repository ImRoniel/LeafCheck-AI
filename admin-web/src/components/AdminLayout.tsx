import { NavLink, Outlet } from 'react-router-dom'
import { roleLabels, useSession } from '../context/session'

const navigation = [
  { to: '/dashboard', label: 'Overview' },
  { to: '/users', label: 'Users' },
  { to: '/devices', label: 'Devices' },
  { to: '/audit', label: 'Audit logs' },
]

export function AdminLayout() {
  const { user, logout, status } = useSession()

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-white focus:p-4"
      >
        Skip to content
      </a>

      <aside className="border-b border-slate-200 bg-white p-5 md:w-64 md:shrink-0 md:border-r md:border-b-0 md:p-6">
        <NavLink to="/dashboard" className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-800 text-sm font-bold text-white" aria-hidden="true">
            LC
          </span>
          <span>
            <span className="block font-semibold tracking-tight">LeafCheck AI</span>
            <span className="text-xs text-slate-500">Administration</span>
          </span>
        </NavLink>

        <nav aria-label="Main navigation" className="mt-7 grid grid-cols-2 gap-2 md:grid-cols-1">
          {navigation.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4 lg:px-10">
          <p className="text-sm font-medium text-slate-500">Admin console</p>
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <div className="min-w-0 text-right">
              <p className="break-all text-sm font-medium">{user?.email ?? 'No active session'}</p>
              <p className="text-xs text-slate-500">{user ? roleLabels[user.role] : 'No role assigned'}</p>
            </div>
            <button
              type="button"
              onClick={() => { void logout() }}
              disabled={status === 'signingOut'}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Log out
            </button>
          </div>
        </header>

        <main id="main-content" className="flex-1 p-6 lg:p-10">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
