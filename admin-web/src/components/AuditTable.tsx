import { auditOutcome, type AuditRow } from '../lib/admin'
import { formatAuditAction, formatTimestamp } from '../lib/format'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import { TableMessage } from './AdminTable'

const tones: Record<string, BadgeTone> = { Succeeded: 'success', Failed: 'danger', Requested: 'warning', Cancelled: 'neutral' }

export function AuditTable({ entries, loading, error }: { entries: AuditRow[]; loading: boolean; error?: string | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-4xl" aria-busy={loading}>
        <caption className="sr-only">Security and user management audit trail</caption>
        <thead className="border-b border-edge bg-panel-muted"><tr>{['Timestamp', 'Actor', 'Action', 'Target', 'Outcome'].map(label => <th key={label} scope="col" className="table-head">{label}</th>)}</tr></thead>
        <tbody>
          {loading ? <TableMessage columns={5}>Loading activity...</TableMessage> : error ? <TableMessage columns={5}>Activity could not be loaded.</TableMessage> : entries.length === 0 ? <TableMessage columns={5}>No audit entries yet.</TableMessage> : entries.map(log => {
            const outcome = auditOutcome(log)
            const actorId = log.actorId ?? (typeof log.metadata?.actorId === 'string' ? log.metadata.actorId : null)
            return (
              <tr key={log.id} className="table-row">
                <td className="table-cell whitespace-nowrap text-xs"><time dateTime={log.createdAt}>{formatTimestamp(log.createdAt)}</time></td>
                <td className="table-cell break-all" title={actorId ?? undefined}>{log.actorEmail ?? <span className="text-subtle">{actorId ? 'Deleted account' : 'Unavailable'}</span>}</td>
                <td className="table-cell font-medium text-foreground" title={log.action}>{formatAuditAction(log.action)}</td>
                <td className="table-cell break-all" title={log.targetId ?? undefined}>{log.targetEmail ?? <span className="text-subtle">{log.targetId ? 'Deleted or unavailable account' : '—'}</span>}</td>
                <td className="table-cell"><StatusBadge tone={tones[outcome] ?? 'neutral'} dot>{outcome}</StatusBadge></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
