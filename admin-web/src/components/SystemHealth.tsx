import { Activity, RefreshCw } from 'lucide-react'
import { useAdminResource } from '../hooks/useAdminResource'
import { useAutoRefresh } from '../hooks/useAutoRefresh'
import { readAdminHealth } from '../lib/admin'
import { formatTimestamp } from '../lib/format'
import { RequestError } from './AdminTable'
import { StatusBadge } from './StatusBadge'

export function SystemHealth() {
  const { result, loading, refreshing, error, reload } = useAdminResource('/admin/health', readAdminHealth)
  useAutoRefresh(reload)
  const observed = error ? null : result
  const services = [
    { label: 'API', status: observed?.api ?? (error ? 'down' : 'unknown') },
    { label: 'PostgreSQL', status: observed?.postgres ?? 'unknown' },
    { label: 'Telemetry (MongoDB)', status: observed?.mongo ?? 'unknown' },
  ]
  return (
    <article aria-label="System Health" className="surface mt-6 p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><h2 className="flex items-center gap-2 font-semibold"><Activity size={18} className="text-brand" aria-hidden="true" />System Health</h2>
          <p className="mt-1 text-xs leading-5 text-subtle">Service readiness, checked every minute while this tab is visible.</p></div>
        <button type="button" onClick={reload} disabled={loading || refreshing} className="button-secondary" aria-label="Refresh system health"><RefreshCw size={15} aria-hidden="true" /><span className="hidden sm:inline">Check now</span></button>
      </div>
      {error && <RequestError message={'System health could not be confirmed. ' + error} retry={reload} />}
      <dl className="grid gap-3 sm:grid-cols-3" aria-busy={loading || refreshing}>
        {services.map(({ label, status }) => <div key={label} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-panel-muted px-4 py-3">
          <dt className="text-sm font-medium">{label}</dt>
          <dd><StatusBadge tone={status === 'ok' ? 'success' : status === 'down' ? 'danger' : 'neutral'} dot>{loading ? 'Checking...' : status === 'ok' ? 'Healthy' : status === 'down' ? 'Unavailable' : 'Unknown'}</StatusBadge></dd>
        </div>)}
      </dl>
      {result && <p className="mt-4 text-xs text-subtle">{error ? 'Last successful check: ' : 'Last checked '}{formatTimestamp(result.checkedAt)}. {refreshing ? 'Refreshing health...' : error ? 'Current database status is unknown.' : 'Device connectivity is reported separately above.'}</p>}
    </article>
  )
}
