import { useState, type FormEvent } from 'react'
import { RequestError, TableMessage, TablePagination } from '../components/AdminTable'
import { useAdminList } from '../hooks/useAdminList'
import { readDeviceRow } from '../lib/admin'

const statusLabels: Record<string, string> = {
  ONLINE: 'Online', OFFLINE: 'Offline', SIMULATED: 'Simulated', NO_READINGS: 'No readings', UNKNOWN: 'Unknown',
}

export function DevicesPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const { result, loading, error, reload } = useAdminList('/admin/devices', readDeviceRow, page, query)

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setQuery(search.trim())
  }

  return (
    <section aria-labelledby="devices-heading">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><h1 id="devices-heading" className="text-2xl font-semibold tracking-tight">Devices</h1><p className="mt-2 text-sm text-slate-500">Monitor device connections and linked plants.</p></div>
        <button type="button" onClick={reload} disabled={loading} className="button-secondary">Refresh</button>
      </div>
      <form onSubmit={handleSearch} role="search" className="mb-5 flex max-w-lg gap-2">
        <label htmlFor="device-search" className="sr-only">Search devices</label>
        <input id="device-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by MAC, device, or plant name" className="form-input" />
        <button type="submit" className="button-secondary">Search</button>
      </form>
      {error && <RequestError message={error} retry={reload} />}
      {result?.telemetryDegraded && <p role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Some sensor readings are temporarily unavailable. Device status may be unknown.</p>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-xl" aria-busy={loading}>
            <caption className="sr-only">Device inventory and connection status</caption>
            <thead className="border-b border-slate-200 bg-slate-50"><tr>{['MAC', 'Name', 'Linked Plant', 'Status'].map(label => <th key={label} scope="col" className="table-head">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <TableMessage columns={4}>Loading devices...</TableMessage> : error ? <TableMessage columns={4}>Devices could not be loaded.</TableMessage> : !result?.data.length ? <TableMessage columns={4}>No devices found.</TableMessage> : result.data.map(device => (
                <tr key={device.id} className="hover:bg-slate-50">
                  <td className="table-cell font-mono text-xs whitespace-nowrap">{device.macAddress}</td>
                  <td className="table-cell font-medium text-slate-900">{device.name}</td>
                  <td className="table-cell">{device.plants.length ? device.plants.map(plant => plant.name).join(', ') : <span className="text-slate-400">Unlinked</span>}</td>
                  <td className="table-cell"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${device.connectionStatus === 'ONLINE' ? 'bg-emerald-50 text-emerald-800' : device.connectionStatus === 'OFFLINE' ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-600'}`}>{statusLabels[device.connectionStatus] ?? 'Unknown'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination pagination={result?.pagination} loading={loading} onPage={setPage} />
      </div>
    </section>
  )
}
