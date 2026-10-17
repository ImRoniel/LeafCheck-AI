import { useState } from 'react'
import { apiFetch } from '../lib/api'
import type { DeviceDetails } from '../lib/operations'
import { ActionModal } from './ActionModal'

export function RenameDeviceModal({ device, onClose, onSaved, onRefresh }: {
  device: DeviceDetails; onClose: () => void; onSaved: () => void; onRefresh: () => void
}) {
  const [name, setName] = useState(device.name)
  return <ActionModal title="Rename device" description={`Change the display name for ${device.macAddress}.`} confirmLabel="Save name"
    disabled={!name.trim() || name.trim() === device.name || name.trim().length > 80} onClose={onClose} onRefresh={onRefresh}
    onSubmit={async (reason, signal) => {
      await apiFetch(`/admin/devices/${encodeURIComponent(device.id)}`, { method: 'PATCH', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), updatedAt: device.updatedAt, reason }) })
      onSaved()
    }}>
    <div><label htmlFor="device-name" className="mb-2 block text-sm font-medium">Device name</label>
      <input id="device-name" autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} className="form-input" /></div>
  </ActionModal>
}
