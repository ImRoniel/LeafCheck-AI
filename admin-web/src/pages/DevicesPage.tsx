import { useState, type FormEvent } from 'react'
import { Clock3, Cpu, RefreshCw, Search, Sprout } from 'lucide-react'
import { RequestError, TableMessage, TablePagination } from '../components/AdminTable'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge, type BadgeTone } from '../components/StatusBadge'
import { useAdminList } from '../hooks/useAdminList'
import { useNow } from '../hooks/useNow'
import { readDeviceRow } from '../lib/admin'
import { formatLastSeen, formatTimestamp } from '../lib/format'

const statusLabels: Record<string, string> = {
  ONLINE: 'Online', OFFLINE: 'Offline', SIMULATED: 'Simulated', NO_READINGS: 'No readings', UNKNOWN: 'Unknown',
}
const tones: Record<string, BadgeTone> = { ONLINE: 'success', OFFLINE: 'danger', SIMULATED: 'info', NO_READINGS: 'warning' }

export function DevicesPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const now = useNow()
  const { result, loading, error, reload } = useAdminList('/admin/devices', readDeviceRow, page, query)

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setQuery(search.trim())
  }

  return (
    <section aria-label="Device inventory">
      <PageHeader title="Device Inventory" icon={Cpu} description="Monitor connected hardware, plant assignments, and the latest sensor contact."
        actions={<button type="button" onClick={reload} disabled={loading} className="button-secondary"><RefreshCw size={15} aria-hidden="true" />Refresh</button>} />
      {error && <RequestError message={error} retry={reload} />}
      {result?.telemetryDegraded && <p role="status" className="notice-warning mb-5">Some sensor readings are temporarily unavailable. Device status may be unknown.</p>}
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-edge p-5">
          <div><h2 className="text-sm font-semibold">Registered devices</h2><p className="mt-1 text-xs text-subtle">Online status uses a 30-minute freshness window.</p></div>
          <form onSubmit={handleSearch} role="search" className="flex w-full max-w-md gap-2">
            <div className="relative min-w-0 flex-1"><Search size={16} aria-hidden="true" className="pointer-events-none absolute top-3 left-3 text-subtle" /><label htmlFor="device-search" className="sr-only">Search devices</label>
              <input id="device-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="MAC, device, or plant name" className="form-input pl-9" /></div>
            <button type="submit" className="button-secondary">Search</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl" aria-busy={loading}>
            <caption className="sr-only">Device inventory and connection status</caption>
            <thead className="border-b border-edge bg-panel-muted"><tr>{['MAC', 'Name', 'Linked Plant', 'Status', 'Last Seen'].map(label => <th key={label} scope="col" className="table-head">{label}</th>)}</tr></thead>
            <tbody>
              {loading ? <TableMessage columns={5}>Loading devices...</TableMessage> : error ? <TableMessage columns={5}>Devices could not be loaded.</TableMessage> : !result?.data.length ? <TableMessage columns={5}>No devices found.</TableMessage> : result.data.map(device => (
                <tr key={device.id} className="table-row">
                  <td className="table-cell font-mono text-xs whitespace-nowrap">{device.macAddress}</td>
                  <td className="table-cell font-semibold text-foreground"><span className="flex items-center gap-2"><Cpu size={16} className="shrink-0 text-subtle" aria-hidden="true" />{device.name}</span></td>
                  <td className="table-cell">{device.plants.length ? <span className="flex items-center gap-2"><Sprout size={15} className="shrink-0 text-brand" aria-hidden="true" />{device.plants.map(plant => plant.name).join(', ')}</span> : <span className="text-subtle">Unlinked</span>}</td>
                  <td className="table-cell"><StatusBadge tone={tones[device.connectionStatus] ?? 'neutral'} dot>{statusLabels[device.connectionStatus] ?? 'Unknown'}</StatusBadge></td>
                  <td className="table-cell whitespace-nowrap text-xs"><span className="inline-flex items-center gap-1.5" title={device.lastReadingAt ? formatTimestamp(device.lastReadingAt) : undefined}><Clock3 size={13} className="text-subtle" aria-hidden="true" />{device.readingError ? 'Unavailable' : formatLastSeen(device.lastReadingAt, now)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination pagination={result?.pagination} loading={loading} onPage={setPage} />
      </div>
      <p className="mt-3 text-xs text-subtle">Last Seen updates automatically. Refresh to fetch new sensor readings. <span className="sm:hidden">Swipe the table to view all columns.</span></p>
    </section>
  )
}
