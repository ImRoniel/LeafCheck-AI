import { apiFetch } from '../lib/api'
import type { DeviceDetails } from '../lib/operations'
import { ActionModal } from './ActionModal'

export function UnlinkDeviceModal({ device, onClose, onSaved, onRefresh }: {
  device: DeviceDetails; onClose: () => void; onSaved: () => void; onRefresh: () => void
}) {
  return <ActionModal title="Unlink device from plant?" description={`Disconnect ${device.name} from ${device.pairing?.plantName ?? 'its plant'}. Historical readings and reports remain available.`}
    confirmLabel="Unlink device" danger disabled={!device.pairing} onClose={onClose} onRefresh={onRefresh}
    onSubmit={async (reason, signal) => {
      await apiFetch(`/admin/devices/${encodeURIComponent(device.id)}/unlink`, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: device.updatedAt, expectedPairingId: device.pairing?.id, reason }) })
      onSaved()
    }} />
}
