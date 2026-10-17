import { ArrowUpRight, Cpu, LayoutDashboard, RefreshCw, ScanLine, ShieldCheck, Sprout, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { RequestError } from '../components/AdminTable'
import { AuditTable } from '../components/AuditTable'
import { PageHeader } from '../components/PageHeader'
import { useSession } from '../context/session'
import { useAdminList } from '../hooks/useAdminList'
import { useAdminResource } from '../hooks/useAdminResource'
import { readAdminStats, readAuditRow } from '../lib/admin'
import { formatTimestamp } from '../lib/format'
import { hasPermission } from '../lib/permissions'

const numbers = new Intl.NumberFormat()

export function DashboardPage() {
  const { user } = useSession()
  const canReadAudit = !!user && hasPermission(user.role, 'audit.read')
  const stats = useAdminResource('/admin/stats', readAdminStats)
  const activity = useAdminList('/admin/audit', readAuditRow, 1, '', { pageSize: 5, enabled: canReadAudit })
  const metrics = [
    { label: 'Total users', value: stats.result?.totalUsers, icon: Users, note: 'All registered accounts', color: 'bg-info-bg text-info-fg' },
    { label: 'Active devices', value: stats.result?.totalActiveDevices, icon: Cpu, note: 'Physical · seen in the last 30 minutes', color: 'bg-success-bg text-success-fg' },
    { label: 'Plants registered', value: stats.result?.totalPlants, icon: Sprout, note: 'Across the platform', color: 'bg-success-bg text-success-fg' },
    { label: 'AI scans', value: stats.result?.totalAiScans, icon: ScanLine, note: 'Saved diagnostic reports', color: 'bg-warning-bg text-warning-fg' },
  ]

  function refresh() { stats.reload(); if (canReadAudit) activity.reload() }

  return (
    <section aria-label="Platform overview">
      <PageHeader title="Overview" icon={LayoutDashboard}
        description={canReadAudit ? 'Your platform at a glance. Monitor growth, connected hardware, and administrative activity.' : 'An operational snapshot of the platform and connected hardware.'}
        actions={<button type="button" onClick={refresh} disabled={stats.loading || activity.loading} className="button-secondary"><RefreshCw size={15} aria-hidden="true" />Refresh</button>} />
      {stats.error && <RequestError message={stats.error} retry={stats.reload} />}
      {stats.result?.telemetryDegraded && <p role="status" className="notice-warning mb-5">Live device connectivity is temporarily unavailable. Other platform totals remain available.</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy={stats.loading}>
        {metrics.map(({ label, value, icon: Icon, note, color }) => (
          <article key={label} aria-label={label} className="surface p-5">
            <div className="flex items-center justify-between gap-3"><h2 className="text-xs font-medium text-secondary">{label}</h2><span className={'flex size-9 items-center justify-center rounded-xl ' + color}><Icon size={18} aria-hidden="true" /></span></div>
            <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums text-foreground">{stats.loading ? <span className="block h-9 w-20 animate-pulse rounded-md bg-edge motion-reduce:animate-none"><span className="sr-only">Loading</span></span> : value === null ? <span className="text-xl">Unavailable</span> : value === undefined ? '—' : numbers.format(value)}</p>
            <p className="mt-2 text-[11px] leading-5 text-subtle">{note}</p>
          </article>
        ))}
      </div>
      {stats.result && <p className="mt-3 text-right text-[11px] text-subtle">Updated {formatTimestamp(stats.result.asOf)}</p>}

      {canReadAudit ? (
        <div className="surface mt-8 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-5">
            <div><h2 className="font-semibold text-foreground">Recent Activity</h2><p className="mt-1 text-xs text-subtle">The five most recent administrative events.</p></div>
            <Link to="/audit" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline">View all activity<ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
          {activity.error && <div className="px-5 pt-5"><RequestError message={activity.error} retry={activity.reload} /></div>}
          <AuditTable entries={activity.result?.data ?? []} loading={activity.loading} error={activity.error} />
        </div>
      ) : (
        <div className="surface mt-8 flex flex-wrap items-center justify-between gap-5 p-6">
          <div className="flex items-start gap-3"><ShieldCheck size={22} className="mt-1 shrink-0 text-brand" aria-hidden="true" /><div><h2 className="font-semibold">Operational workspace</h2><p className="mt-2 max-w-xl text-sm leading-6 text-secondary">View device connections, linked plants, and last-seen readings. User management and audit history are reserved for SuperAdmins.</p></div></div>
          <Link to="/devices" className="button-primary">View device inventory<ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
      )}
    </section>
  )
}
