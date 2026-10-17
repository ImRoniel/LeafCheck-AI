import { useState, type FormEvent } from 'react'
import { Activity, RefreshCw, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { RequestError, TableMessage, TablePagination } from '../components/AdminTable'
import { DeviceDetailsPanel } from '../components/DeviceDetailsPanel'
import { useAdminList } from '../hooks/useAdminList'
import { readDeviceRow } from '../lib/admin'
import { formatTimestamp } from '../lib/format'

export function DiagnosticsPage() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const selected = params.get('device')
  const resource = useAdminList('/admin/devices', readDeviceRow, page, query, { onPageChange: setPage })
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(1); setQuery(search.trim()); if (page === 1 && search.trim() === query) resource.reload() }
  return <section aria-label="Device diagnostics">
    <PageHeader title="Diagnostics" icon={Activity} description="Inspect the five latest stored readings for a physical or simulated device."
      actions={<button type="button" className="button-secondary" onClick={resource.reload} disabled={resource.loading || resource.refreshing}><RefreshCw size={15} aria-hidden="true" />Refresh</button>} />
    <p className="notice-warning mb-5">Fetching stored readings does not request a new hardware measurement. Measurement timestamps show when data was captured.</p>
    {resource.error && <RequestError message={resource.error} retry={resource.reload} />}
    <div className="surface overflow-hidden">
      <form className="flex max-w-lg gap-2 p-5" role="search" onSubmit={submit}><label htmlFor="diagnostics-search" className="sr-only">Search diagnostics devices</label><input id="diagnostics-search" className="form-input" type="search" maxLength={100} placeholder="MAC, device, or plant name" value={search} onChange={event => setSearch(event.target.value)} /><button type="submit" className="button-secondary"><Search size={15} aria-hidden="true" />Search</button></form>
      <div className="overflow-x-auto"><table className="w-full min-w-xl" aria-busy={resource.loading || resource.refreshing}>
        <caption className="sr-only">Select a device to inspect telemetry</caption>
        <thead className="border-y border-edge bg-panel-muted"><tr>{['Device', 'MAC', 'Last measurement', 'Diagnostics'].map(label => <th key={label} scope="col" className="table-head">{label}</th>)}</tr></thead>
        <tbody>{resource.loading ? <TableMessage columns={4}>Loading devices...</TableMessage> : resource.error ? <TableMessage columns={4}>Devices could not be loaded.</TableMessage> : !resource.result?.data.length ? <TableMessage columns={4}>No devices found.</TableMessage> : resource.result.data.map(device => <tr key={device.id} className="table-row">
          <td className="table-cell font-semibold">{device.name}{(device.connectionStatus === 'SIMULATED' || device.macAddress.startsWith('DEMO:')) && <span className="mt-1 block text-xs font-normal text-info-fg">Simulated</span>}</td><td className="table-cell font-mono text-xs">{device.macAddress}</td>
          <td className="table-cell text-xs">{device.lastReadingAt ? formatTimestamp(device.lastReadingAt) : 'Unavailable'}</td>
          <td className="table-cell"><button type="button" className="button-secondary" onClick={() => setParams({ device: device.id })} aria-label={`Inspect ${device.name}`} aria-haspopup="dialog">Inspect readings</button></td>
        </tr>)}</tbody>
      </table></div>
      <TablePagination pagination={resource.result?.pagination} loading={resource.loading || resource.refreshing} onPage={setPage} />
    </div>
    {selected && <DeviceDetailsPanel key={selected} deviceId={selected} diagnostics onClose={() => setParams({})} onChanged={resource.reload} />}
  </section>
}
