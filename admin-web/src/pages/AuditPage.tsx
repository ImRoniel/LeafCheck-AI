import { useState, type FormEvent } from 'react'
import { Filter, RefreshCw, ScrollText, X } from 'lucide-react'
import { RequestError, TablePagination } from '../components/AdminTable'
import { AuditTable } from '../components/AuditTable'
import { PageHeader } from '../components/PageHeader'
import { FieldError } from '../components/FieldError'
import { useAdminList } from '../hooks/useAdminList'
import { readAuditRow } from '../lib/admin'
import { auditFilterQuery, emptyAuditFilters, type AuditFilters } from '../lib/audit-filters'
import { formatAuditAction } from '../lib/format'

const actions = ['ADMIN_LOGIN_VERIFIED', 'ADMIN_OTP_FAILED', 'ADMIN_OTP_RESENT', 'ADMIN_OTP_CANCELLED', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETE_REQUESTED', 'USER_DELETED', 'DEVICE_RENAMED', 'DEVICE_UNLINKED', 'USER_SESSIONS_REVOKED', 'HARDWARE_PROVISIONED', 'HARDWARE_UPDATED', 'HARDWARE_BACKFILLED', 'SETTINGS_UPDATED']

export function AuditPage() {
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState(emptyAuditFilters)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [filterErrors, setFilterErrors] = useState<Partial<Record<keyof AuditFilters, string>>>({})
  const { result, loading, refreshing, error, reload } = useAdminList('/admin/audit', readAuditRow, page, '', { filters, onPageChange: setPage })
  const filtered = Object.keys(filters).length > 0

  function change(field: keyof AuditFilters, value: string) {
    setDraft(current => ({ ...current, [field]: value }))
    setFilterErrors(current => ({ ...current, [field]: undefined }))
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = auditFilterQuery(draft)
    setFilterErrors(next.errors)
    if (Object.keys(next.errors).length) return
    if (page === 1 && JSON.stringify(filters) === JSON.stringify(next.params)) reload()
    setPage(1)
    setFilters(next.params)
  }

  function clear() {
    setDraft(emptyAuditFilters)
    setFilterErrors({})
    setPage(1)
    setFilters({})
    if (page === 1 && !filtered) reload()
  }
  return (
    <section aria-label="Audit logs">
      <PageHeader title="Audit Logs" icon={ScrollText}
        description="A record of authentication, account, hardware, and settings changes. Timestamps use your local time zone."
        actions={<button type="button" onClick={reload} disabled={loading || refreshing} className="button-secondary"><RefreshCw size={15} aria-hidden="true" />Refresh</button>} />
      {error && <RequestError message={error} retry={reload} />}
      <div className="surface overflow-hidden">
        <form onSubmit={apply} noValidate aria-label="Filter audit logs" className="space-y-4 border-b border-edge p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div><label htmlFor="audit-action" className="mb-2 block text-sm font-medium">Action</label>
              <input id="audit-action" value={draft.action} onChange={event => change('action', event.target.value.toUpperCase())} list="audit-actions" maxLength={80} placeholder="All actions" autoComplete="off" className="form-input"
                aria-invalid={!!filterErrors.action} aria-describedby={filterErrors.action ? 'audit-action-error' : undefined} />
              <datalist id="audit-actions">{actions.map(action => <option key={action} value={action}>{formatAuditAction(action)}</option>)}</datalist>
              <FieldError id="audit-action-error" message={filterErrors.action} />
            </div>
            <div><label htmlFor="audit-from" className="mb-2 block text-sm font-medium">From Date</label>
              <input id="audit-from" type="date" value={draft.from} onChange={event => change('from', event.target.value)} className="form-input"
                aria-invalid={!!filterErrors.from} aria-describedby={filterErrors.from ? 'audit-from-error' : undefined} />
              <FieldError id="audit-from-error" message={filterErrors.from} />
            </div>
            <div><label htmlFor="audit-to" className="mb-2 block text-sm font-medium">To Date</label>
              <input id="audit-to" type="date" value={draft.to} onChange={event => change('to', event.target.value)} className="form-input"
                aria-invalid={!!filterErrors.to} aria-describedby={filterErrors.to ? 'audit-to-error' : undefined} />
              <FieldError id="audit-to-error" message={filterErrors.to} />
            </div>
          </div>
          <details className="text-sm text-secondary"><summary className="cursor-pointer">Actor and target filters</summary>
            <p className="mt-2 text-xs text-subtle">Use the account IDs available on hover in the table. These filters match IDs, not email text.</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="audit-actor" className="mb-2 block text-sm font-medium">Actor ID</label><input id="audit-actor" value={draft.actorId} onChange={event => change('actorId', event.target.value)} maxLength={36} className="form-input" placeholder="Optional user UUID"
                aria-invalid={!!filterErrors.actorId} aria-describedby={filterErrors.actorId ? 'audit-actor-error' : undefined} /><FieldError id="audit-actor-error" message={filterErrors.actorId} /></div>
              <div><label htmlFor="audit-target" className="mb-2 block text-sm font-medium">Target ID</label><input id="audit-target" value={draft.targetId} onChange={event => change('targetId', event.target.value)} maxLength={200} className="form-input" placeholder="Optional target ID"
                aria-invalid={!!filterErrors.targetId} aria-describedby={filterErrors.targetId ? 'audit-target-error' : undefined} /><FieldError id="audit-target-error" message={filterErrors.targetId} /></div>
            </div>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-subtle">Dates include the full day in your local time zone.</p>
            <div className="flex gap-2"><button type="button" onClick={clear} className="button-secondary"><X size={15} aria-hidden="true" />Clear filters</button><button type="submit" className="button-primary"><Filter size={15} aria-hidden="true" />Apply filters</button></div>
          </div>
        </form>
        <AuditTable entries={result?.data ?? []} loading={loading} error={error} emptyMessage={filtered ? 'No activity matches these filters. Try a different action or date range.' : undefined} />
        <TablePagination pagination={result?.pagination} loading={loading || refreshing} onPage={setPage} />
      </div>
      <p className="mt-3 text-xs leading-5 text-subtle">Deleted accounts retain their audit history. Account IDs and original action codes are available on hover.</p>
    </section>
  )
}
