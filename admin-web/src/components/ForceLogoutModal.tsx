import type { UserRow } from '../lib/admin'
import { apiFetch } from '../lib/api'
import { ActionModal } from './ActionModal'

export function ForceLogoutModal({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  return <ActionModal title="Force logout?" description={`End all application sessions for ${user.name ?? user.emailMasked}. The account remains active and can sign in again.`}
    confirmLabel="Force Logout" danger onClose={onClose} onSubmit={async (reason, signal) => {
      await apiFetch(`/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })
      onSaved()
    }} />
}
