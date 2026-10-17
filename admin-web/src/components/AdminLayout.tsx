import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Activity, ChevronRight, CircleUserRound, Cpu, LayoutDashboard, Leaf, LogOut, Moon, PlugZap, ScrollText, Settings, ShieldCheck, Sun, Users, type LucideIcon } from 'lucide-react'
import { roleLabels, useSession } from '../context/session'
import { useTheme } from '../context/theme'
import { initials } from '../lib/format'
import { hasPermission, type Permission } from '../lib/permissions'

const navigation: { to: string; label: string; icon: LucideIcon; permission?: Permission }[] = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/users', label: 'Users', icon: Users, permission: 'users.read' },
  { to: '/devices', label: 'Devices', icon: Cpu, permission: 'devices.read' },
  { to: '/diagnostics', label: 'Diagnostics', icon: Activity, permission: 'devices.read' },
  { to: '/provisioning', label: 'Provisioning', icon: ShieldCheck, permission: 'devices.provision' },
  { to: '/integrations', label: 'AI & API Monitor', icon: PlugZap, permission: 'integrations.read' },
  { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings.read' },
  { to: '/audit', label: 'Audit logs', icon: ScrollText, permission: 'audit.read' },
]

const pageTitles: Record<string, string> = { '/dashboard': 'Overview', '/users': 'User Management', '/devices': 'Device Inventory', '/diagnostics': 'Diagnostics', '/provisioning': 'Provisioning', '/integrations': 'AI & API Monitor', '/settings': 'System Settings', '/audit': 'Audit Logs', '/forbidden': 'Access Restricted' }

export function AdminLayout() {
  const { user, logout, status } = useSession()
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()
  const title = pageTitles[pathname] ?? 'Workspace'
  useEffect(() => { document.title = `${title} | LeafCheck Admin` }, [title])

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-panel focus:p-4"
      >
        Skip to content
      </a>

      <aside className="flex flex-col bg-[#112d23] p-5 text-white md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:p-6">
        <NavLink to="/dashboard" className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl border border-emerald-200/15 bg-emerald-300/10 text-emerald-300" aria-hidden="true">
            <Leaf size={23} />
          </span>
          <span>
            <span className="block font-semibold tracking-tight">LeafCheck AI</span>
            <span className="text-xs text-emerald-100/60">Administration</span>
          </span>
        </NavLink>

        <p className="mt-10 hidden text-[10px] font-semibold tracking-[0.18em] text-emerald-100/40 md:block">WORKSPACE</p>
        <nav aria-label="Main navigation" className="mt-5 grid grid-cols-2 gap-1.5 md:mt-3 md:grid-cols-1">
          {navigation.filter(item => !item.permission || (user && hasPermission(user.role, item.permission))).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-300/15 text-emerald-200'
                    : 'text-emerald-50/65 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon size={18} aria-hidden="true" />{label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-white/10 pt-5 md:block">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-200"><ShieldCheck size={16} aria-hidden="true" />Role-based access</div>
          <p className="mt-2 text-xs leading-5 text-emerald-100/45">Your workspace follows your account permissions.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-edge bg-panel px-6 py-4 lg:px-10">
          <p className="flex items-center gap-2 text-xs text-subtle"><span>Workspace</span><ChevronRight size={13} aria-hidden="true" /><span className="font-medium text-secondary">{title}</span></p>
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <button type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} className="button-secondary p-2.5">
              {theme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
            </button>
            <span aria-hidden="true" className="hidden size-9 items-center justify-center rounded-full bg-success-bg text-xs font-semibold text-success-fg xl:flex">{user ? initials(user.name ?? user.email) : <CircleUserRound size={18} />}</span>
            <div className="min-w-0">
              <p className="break-all text-xs font-semibold">{user?.email ?? 'No active session'}</p>
              <p className="mt-0.5 text-[11px] text-subtle">{user ? roleLabels[user.role] : 'No role assigned'}</p>
            </div>
            <button
              type="button"
              onClick={() => { void logout() }}
              disabled={status === 'signingOut'}
              className="button-secondary"
            >
              <LogOut size={15} aria-hidden="true" /><span>Log out</span>
            </button>
          </div>
        </header>

        <main id="main-content" className="flex-1 p-5 sm:p-6 lg:p-9">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
