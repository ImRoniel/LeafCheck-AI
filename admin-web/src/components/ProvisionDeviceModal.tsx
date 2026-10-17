import { useState } from 'react'
import { apiFetch } from '../lib/api'
import type { ProvisionRow } from '../lib/operations'
import { ActionModal } from './ActionModal'

export function ProvisionDeviceModal({ provision, onClose, onSaved, onRefresh }: {
  provision: ProvisionRow | null; onClose: () => void; onSaved: () => void; onRefresh: () => void
}) {
  const [macAddress, setMacAddress] = useState('')
  const [label, setLabel] = useState(provision?.label ?? '')
  const [status, setStatus] = useState<'APPROVED' | 'REVOKED'>(provision?.status ?? 'APPROVED')
  const changes = provision ? { ...(label.trim() !== (provision.label ?? '') ? { label: label.trim() || null } : {}), ...(status !== provision.status ? { status } : {}) } : null
  return <ActionModal title={provision ? 'Manage hardware approval' : 'Register approved hardware'}
    description={provision ? 'Revoking hardware blocks subsequent claims and telemetry uploads while preserving ownership and history.' : 'Approve a physical hardware identifier before a user claims it.'}
    confirmLabel={provision ? 'Save approval' : 'Register hardware'} danger={status === 'REVOKED'} disabled={provision ? !Object.keys(changes ?? {}).length : !macAddress.trim()}
    onClose={onClose} onRefresh={onRefresh} onSubmit={async (reason, signal) => {
      await apiFetch(provision ? `/admin/devices/whitelist/${encodeURIComponent(provision.id)}` : '/admin/devices/whitelist', {
        method: provision ? 'PATCH' : 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(provision ? { ...changes, updatedAt: provision.updatedAt, reason } : { macAddress: macAddress.trim(), ...(label.trim() ? { label: label.trim() } : {}), reason }),
      })
      onSaved()
    }}>
    <div><label htmlFor="provision-mac" className="mb-2 block text-sm font-medium">MAC address</label>
      <input id="provision-mac" className="form-input font-mono" value={provision?.macAddress ?? macAddress} onChange={event => setMacAddress(event.target.value)} readOnly={!!provision} required maxLength={100} autoFocus={!provision} placeholder="AA:BB:CC:DD:EE:FF" /></div>
    <div><label htmlFor="provision-label" className="mb-2 block text-sm font-medium">Label (optional)</label>
      <input id="provision-label" className="form-input" maxLength={100} value={label} onChange={event => setLabel(event.target.value)} autoFocus={!!provision} /></div>
    {provision && <div><label htmlFor="provision-status" className="mb-2 block text-sm font-medium">Approval</label>
      <select id="provision-status" className="form-input" value={status} onChange={event => setStatus(event.target.value === 'REVOKED' ? 'REVOKED' : 'APPROVED')}><option value="APPROVED">Approved</option><option value="REVOKED">Revoked</option></select></div>}
    {status === 'REVOKED' && <p className="notice-warning">This hardware will be blocked from new claims and uploads after you save.</p>}
  </ActionModal>
}
