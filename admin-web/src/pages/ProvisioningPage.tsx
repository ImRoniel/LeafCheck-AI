import { useState, type FormEvent } from 'react'
import { Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { RequestError, TableMessage, TablePagination } from '../components/AdminTable'
import { StatusBadge } from '../components/StatusBadge'
import { ProvisionDeviceModal } from '../components/ProvisionDeviceModal'
import { useAdminList } from '../hooks/useAdminList'
import { readProvisionRow, type ProvisionRow } from '../lib/operations'
import { formatTimestamp } from '../lib/format'

export function ProvisioningPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [dialog, setDialog] = useState<{ provision: ProvisionRow | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const resource = useAdminList('/admin/devices/whitelist', readProvisionRow, page, query, { filters: { status }, onPageChange: setPage })
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(1); setQuery(search.trim()); if (page === 1 && search.trim() === query) resource.reload() }
  function review() { setDialog(null); resource.reload() }
  return <section aria-label="Hardware provisioning">
    <PageHeader title="Provisioning" icon={ShieldCheck} description="Approve hardware before pairing and control whether it can claim or upload."
      actions={<><button type="button" className="button-secondary" onClick={resource.reload} disabled={resource.loading || resource.refreshing}><RefreshCw size={15} aria-hidden="true" />Refresh</button>
        <button type="button" className="button-primary" onClick={() => { setNotice(null); setDialog({ provision: null }) }}><Plus size={15} aria-hidden="true" />Register hardware</button></>} />
    {notice && <p role="status" className="notice-success mb-5">{notice}</p>}
    {resource.error && <RequestError message={resource.error} retry={resource.reload} />}
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-edge p-5">
        <form className="flex w-full max-w-md gap-2" role="search" onSubmit={submit}><label htmlFor="provision-search" className="sr-only">Search hardware</label><input id="provision-search" className="form-input" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="MAC address or label" /><button type="submit" className="button-secondary"><Search size={15} aria-hidden="true" />Search</button></form>
        <div className="flex items-center gap-2"><label htmlFor="provision-filter" className="text-xs text-subtle">Approval</label><select id="provision-filter" className="form-input" value={status} onChange={event => { setPage(1); setStatus(event.target.value) }}><option value="">All hardware</option><option value="APPROVED">Approved</option><option value="REVOKED">Revoked</option></select></div>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-3xl" aria-busy={resource.loading || resource.refreshing}>
        <caption className="sr-only">Hardware approval registry</caption>
        <thead className="border-b border-edge bg-panel-muted"><tr>{['MAC', 'Label', 'State', 'Updated', 'Actions'].map(label => <th key={label} scope="col" className="table-head">{label}</th>)}</tr></thead>
        <tbody>{resource.loading ? <TableMessage columns={5}>Loading hardware approvals...</TableMessage> : resource.error ? <TableMessage columns={5}>Hardware approvals could not be loaded.</TableMessage> : !resource.result?.data.length ? <TableMessage columns={5}>{query ? 'No hardware matches your search.' : status ? 'No hardware matches your filters.' : 'No hardware registered.'}</TableMessage> : resource.result.data.map(row => <tr key={row.id} className="table-row">
          <td className="table-cell font-mono text-xs">{row.macAddress}</td><td className="table-cell">{row.label ?? 'No label'}</td>
          <td className="table-cell"><StatusBadge tone={row.status === 'REVOKED' ? 'danger' : row.claimedDeviceId ? 'success' : 'info'}>{row.status === 'REVOKED' ? 'Revoked' : row.claimedDeviceId ? 'Approved / Claimed' : 'Approved / Unclaimed'}</StatusBadge></td>
          <td className="table-cell text-xs">{formatTimestamp(row.updatedAt)}</td><td className="table-cell"><button type="button" className="button-secondary" onClick={() => { setNotice(null); setDialog({ provision: row }) }} aria-label={`Manage approval for ${row.macAddress}`}>Manage approval</button></td>
        </tr>)}</tbody>
      </table></div>
      <TablePagination pagination={resource.result?.pagination} loading={resource.loading || resource.refreshing} onPage={setPage} />
    </div>
    {dialog && <ProvisionDeviceModal provision={dialog.provision} onClose={() => setDialog(null)} onRefresh={review} onSaved={() => { setNotice(dialog.provision ? 'Hardware approval updated.' : 'Hardware registered and approved.'); setDialog(null); resource.reload() }} />}
  </section>
}
