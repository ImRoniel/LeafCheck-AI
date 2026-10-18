import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Modal } from './Modal'
import { RequestError } from './AdminTable'
import { ApiError } from '../lib/api'
import { errorMessage } from '../lib/admin'

export function ActionModal({ title, description, children, confirmLabel, danger = false, disabled = false, onSubmit, onClose, onRefresh }: {
  title: string; description: string; children?: ReactNode; confirmLabel: string; danger?: boolean; disabled?: boolean
  onSubmit: (reason: string, signal: AbortSignal) => Promise<void>; onClose: () => void; onRefresh?: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || disabled || review || reason.trim().length < 3) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError(null)
    try { await onSubmit(reason.trim(), controller.signal) }
    catch (cause) {
      if (controller.signal.aborted) return
      const duplicateHardware = cause instanceof ApiError && cause.status === 409 && cause.code === 'HARDWARE_ALREADY_REGISTERED'
      const stale = cause instanceof ApiError && cause.status === 409 && !duplicateHardware
      const uncertain = cause instanceof TypeError || (cause instanceof ApiError && (cause.code === 'REQUEST_TIMEOUT' || [408, 502, 504].includes(cause.status)))
      setReview(stale || uncertain)
      setError(duplicateHardware ? 'This MAC address is already registered.' : stale ? 'This record changed after you opened it. Refresh and review the current values before trying again.' : uncertain
        ? 'The request result is unknown. Refresh and check whether the change completed before trying again.' : errorMessage(cause))
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return <Modal title={title} description={description} busy={busy} onClose={() => { if (!pending.current) onClose() }}>
    <form onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy || review} className="space-y-4">
        {children}
        <div><label htmlFor="action-reason" className="mb-2 block text-sm font-medium">Reason</label>
          <textarea id="action-reason" value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={500} rows={3} className="form-input" />
          <p className="mt-1 text-xs text-subtle">Required for the audit log (3–500 characters).</p></div>
      </fieldset>
      {error && <div className="mt-4"><RequestError message={error} /></div>}
      {review && onRefresh && <button type="button" className="button-secondary" onClick={onRefresh}>Refresh and review</button>}
      <div className="mt-6 flex justify-end gap-2 border-t border-edge pt-5">
        <button type="button" onClick={onClose} disabled={busy} className="button-secondary">Cancel</button>
        <button type="submit" disabled={busy || disabled || review || reason.trim().length < 3} className={danger ? 'button-danger' : 'button-primary'}>{busy ? 'Saving...' : confirmLabel}</button>
      </div>
    </form>
  </Modal>
}
