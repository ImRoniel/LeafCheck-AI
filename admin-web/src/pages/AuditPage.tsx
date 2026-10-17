import { useState } from 'react'
import { RefreshCw, ScrollText } from 'lucide-react'
import { RequestError, TablePagination } from '../components/AdminTable'
import { AuditTable } from '../components/AuditTable'
import { PageHeader } from '../components/PageHeader'
import { useAdminList } from '../hooks/useAdminList'
import { readAuditRow } from '../lib/admin'

export function AuditPage() {
  const [page, setPage] = useState(1)
  const { result, loading, error, reload } = useAdminList('/admin/audit', readAuditRow, page)
  return (
    <section aria-label="Audit logs">
      <PageHeader title="Audit Logs" icon={ScrollText}
        description="A clear record of authentication and account changes. Timestamps use your local time zone."
        actions={<button type="button" onClick={reload} disabled={loading} className="button-secondary"><RefreshCw size={15} aria-hidden="true" />Refresh</button>} />
      {error && <RequestError message={error} retry={reload} />}
      <div className="surface overflow-hidden">
        <AuditTable entries={result?.data ?? []} loading={loading} error={error} />
        <TablePagination pagination={result?.pagination} loading={loading} onPage={setPage} />
      </div>
      <p className="mt-3 text-xs leading-5 text-subtle">Deleted accounts retain their audit history. Account IDs and original action codes are available on hover.</p>
    </section>
  )
}
