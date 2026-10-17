import { useState } from 'react'
import { Activity, Pencil, RefreshCw, Unlink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/session'
import { useAdminResource } from '../hooks/useAdminResource'
import { readDeviceDetails, readTelemetryReadings } from '../lib/operations'
import { hasPermission } from '../lib/permissions'
import { formatTimestamp } from '../lib/format'
import { Modal } from './Modal'
import { RequestError } from './AdminTable'
import { StatusBadge } from './StatusBadge'
import { TelemetryReadingsTable } from './TelemetryReadingsTable'
import { RenameDeviceModal } from './RenameDeviceModal'
import { UnlinkDeviceModal } from './UnlinkDeviceModal'

export function DeviceDetailsPanel({ deviceId, onClose, onChanged, diagnostics = false }: {
  deviceId: string; onClose: () => void; onChanged: () => void; diagnostics?: boolean
}) {
  const { user } = useSession()
  const [action, setAction] = useState<'rename' | 'unlink' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const detail = useAdminResource(`/admin/devices/${encodeURIComponent(deviceId)}`, readDeviceDetails)
  const readings = useAdminResource(`/admin/devices/${encodeURIComponent(deviceId)}/readings?limit=5`, readTelemetryReadings)
  const device = detail.result
  const canManage = !!user && hasPermission(user.role, 'devices.manage')
  function reload() { detail.reload(); readings.reload() }
  function saved() { setNotice(action === 'rename' ? 'Device renamed.' : 'Device unlinked. Historical readings and reports are preserved.'); setAction(null); reload(); onChanged() }
  function review() { setAction(null); reload(); onChanged() }
  return <Modal title="Device details" description="Operational status and the latest stored sensor measurements." onClose={onClose} slideOver>
    {detail.error && <RequestError message={detail.error} retry={detail.reload} />}
    {detail.loading ? <p role="status" className="text-sm text-subtle">Loading device details...</p> : device && <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-xl font-semibold">{device.name}</h3><p className="mt-2 font-mono text-sm text-subtle">{device.macAddress}</p></div>
        <StatusBadge tone={device.simulated ? 'info' : device.connectionStatus === 'ONLINE' ? 'success' : 'neutral'} dot>{device.simulated ? 'Simulated device' : device.connectionStatus.replaceAll('_', ' ')}</StatusBadge>
      </div>
      <dl className="my-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm"><dt className="text-subtle">Linked plant</dt><dd>{device.pairing?.plantName ?? (device.plants.map(plant => plant.name).join(', ') || 'Unlinked')}</dd>
        <dt className="text-subtle">Last measurement</dt><dd>{device.lastReadingAt ? formatTimestamp(device.lastReadingAt) : 'Unavailable'}</dd>
        {user?.role === 'ADMIN' && device.owner && <><dt className="text-subtle">Owner</dt><dd className="break-all">{device.owner.name ?? device.owner.email ?? device.owner.id}{device.owner.name && device.owner.email && <span className="mt-1 block text-xs text-subtle">{device.owner.email}</span>}</dd></>}
      </dl>
      <div className="mb-6 flex flex-wrap gap-2">
        {canManage && <><button type="button" className="button-secondary" onClick={() => { setNotice(null); setAction('rename') }} disabled={detail.refreshing || !!detail.error}><Pencil size={15} aria-hidden="true" />Rename</button>
          <button type="button" className="button-secondary" onClick={() => { setNotice(null); setAction('unlink') }} disabled={!device.pairing || detail.refreshing || !!detail.error}><Unlink size={15} aria-hidden="true" />{device.pairing ? `Unlink from ${device.pairing.plantName}` : 'Unlink from Plant'}</button></>}
        {!diagnostics && <Link to={`/diagnostics?device=${encodeURIComponent(deviceId)}`} className="button-secondary"><Activity size={15} aria-hidden="true" />Open diagnostics</Link>}
      </div>
    </>}
    {notice && <p role="status" className="notice-success mb-5">{notice}</p>}
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Latest readings</h3><button type="button" className="button-secondary" onClick={reload} disabled={detail.loading || detail.refreshing || readings.loading || readings.refreshing}><RefreshCw size={15} aria-hidden="true" />Refresh readings</button></div>
    <p className="mb-4 text-xs leading-5 text-subtle">Refresh fetches stored readings. It does not request a new hardware measurement. Soil values show raw ADC; calibrated percentages are unavailable.</p>
    {device?.simulated && <p role="status" className="notice-warning mb-4">This device generates simulated readings.</p>}
    {readings.error && <RequestError message={readings.error} retry={readings.reload} />}
    <TelemetryReadingsTable readings={readings.result} loading={readings.loading} />
    {readings.updatedAt && <p className="mt-3 text-xs text-subtle">{readings.refreshing ? 'Fetching stored readings...' : readings.error ? 'Last successful fetch: ' : 'Fetched: '}{!readings.refreshing && formatTimestamp(readings.updatedAt)}</p>}
    {action === 'rename' && device && <RenameDeviceModal device={device} onClose={() => setAction(null)} onSaved={saved} onRefresh={review} />}
    {action === 'unlink' && device && <UnlinkDeviceModal device={device} onClose={() => setAction(null)} onSaved={saved} onRefresh={review} />}
  </Modal>
}
