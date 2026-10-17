import { useState } from 'react'
import { RequestError, TableMessage, TablePagination } from '../components/AdminTable'
import { useAdminList } from '../hooks/useAdminList'
import { auditOutcome, readAuditRow } from '../lib/admin'

const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })

export function AuditPage() {
  const [page, setPage] = useState(1)
  const { result, loading, error, reload } = useAdminList('/admin/audit', readAuditRow, page)
  return (
    <section aria-labelledby="audit-heading">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><h1 id="audit-heading" className="text-2xl font-semibold tracking-tight">Audit logs</h1><p className="mt-2 text-sm text-slate-500">Review authentication and account changes. Timestamps use your local time zone.</p></div>
        <button type="button" onClick={reload} disabled={loading} className="button-secondary">Refresh</button>
      </div>
      {error && <RequestError message={error} retry={reload} />}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-4xl" aria-busy={loading}>
            <caption className="sr-only">Security and user management audit trail</caption>
            <thead className="border-b border-slate-200 bg-slate-50"><tr>{['Timestamp', 'Actor', 'Action', 'Target', 'Outcome'].map(label => <th key={label} scope="col" className="table-head">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <TableMessage columns={5}>Loading audit logs...</TableMessage> : error ? <TableMessage columns={5}>Audit logs could not be loaded.</TableMessage> : !result?.data.length ? <TableMessage columns={5}>No audit entries yet.</TableMessage> : result.data.map(log => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="table-cell whitespace-nowrap"><time dateTime={log.createdAt}>{timestamp.format(new Date(log.createdAt))}</time></td>
                  <td className="table-cell break-all font-mono text-xs">{log.actorId ?? (typeof log.metadata?.actorId === 'string' ? log.metadata.actorId : 'Unavailable')}</td>
                  <td className="table-cell font-mono text-xs">{log.action}</td>
                  <td className="table-cell break-all font-mono text-xs">{log.targetId ?? '—'}</td>
                  <td className="table-cell"><span className="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">{auditOutcome(log)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination pagination={result?.pagination} loading={loading} onPage={setPage} />
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">Actors and targets are shown by account ID. Outcomes reflect the recorded action; unclassified events are marked “Recorded”.</p>
    </section>
  )
}
