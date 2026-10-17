import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '../context/session'
import { useCountdown } from '../hooks/useCountdown'
import { ApiError } from '../lib/api'

export function AdminOtpPage() {
  const { user, challenge, otpBusy, verifyAdminOtp, resendAdminOtp, cancelAdminOtp } = useSession()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [action, setAction] = useState<'verify' | 'resend' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const resendIn = useCountdown(Math.max(challenge?.resendAvailableAt ?? 0, retryAt))
  const retryIn = useCountdown(retryAt)
  const expiresIn = useCountdown(challenge?.expiresAt ?? 0)
  const busy = otpBusy || action !== null

  if (user) return <Navigate to="/dashboard" replace />
  if (!challenge) return <Navigate to="/login" replace />
  const pending = challenge

  async function run(next: 'verify' | 'resend' | 'cancel'): Promise<void> {
    if (busy) return
    setAction(next)
    setError(null)
    setNotice(null)
    try {
      if (next === 'verify') {
        await verifyAdminOtp(pending.challengeToken, code)
        navigate('/dashboard', { replace: true })
      } else if (next === 'resend') {
        await resendAdminOtp()
        setCode('')
        setNotice('A new code has been sent. Use the most recent email.')
      } else {
        await cancelAdminOtp()
        navigate('/login', { replace: true })
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (cause instanceof ApiError && cause.status === 429) {
        setRetryAt(Date.now() + Math.max(60, cause.retryAfter ?? 60) * 1000)
        setNotice('Please wait before requesting another code.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to complete this request. Please try again.')
      }
    } finally { setAction(null) }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!busy && code.length === 8 && expiresIn > 0 && retryIn === 0) void run('verify')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section aria-labelledby="otp-heading" className="w-full max-w-md rounded-2xl border border-edge bg-panel p-8 shadow-sm">
        <span aria-hidden="true" className="mb-6 flex size-11 items-center justify-center rounded-xl bg-emerald-800 text-sm font-bold text-white">LC</span>
        <p className="text-sm font-semibold text-brand">Staff verification</p>
        <h1 id="otp-heading" className="mt-3 text-2xl font-semibold tracking-tight">Check your email</h1>
        <p id="otp-instructions" className="mt-3 text-sm leading-6 text-secondary">Enter the 8-digit code sent to your email.</p>
        <p className="mt-1 break-all text-sm font-medium">{pending.maskedEmail}</p>

        <form onSubmit={handleSubmit} aria-busy={busy} className="mt-7 space-y-5">
          <div>
            <label htmlFor="admin-otp" className="block text-sm font-medium">Verification code</label>
            <input id="admin-otp" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
              autoFocus required minLength={8} maxLength={8} pattern="[0-9]{8}" value={code}
              onChange={event => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
              disabled={busy || expiresIn === 0} aria-describedby="otp-instructions otp-expiry" aria-invalid={!!error}
              className="mt-2 w-full rounded-lg border border-edge px-3 py-3 text-center font-mono text-2xl tracking-[0.25em] disabled:bg-canvas" />
            <p id="otp-expiry" className={`mt-2 text-xs ${expiresIn === 0 ? 'text-amber-800' : 'text-subtle'}`}>
              {expiresIn > 0 ? `Code expires in ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')}.` : 'This code has expired. Cancel and sign in again.'}
            </p>
          </div>
          {error && <p role="alert" className="notice-error">{error}</p>}
          {notice && <p role="status" className="notice-warning">{notice}</p>}
          <button type="submit" disabled={busy || code.length !== 8 || expiresIn === 0 || retryIn > 0} className="button-primary w-full">
            {action === 'verify' ? 'Verifying...' : 'Verify Code'}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => { void run('resend') }} disabled={busy || resendIn > 0 || expiresIn === 0} className="button-secondary">
            {action === 'resend' ? 'Sending...' : resendIn > 0 ? `Resend Code (${resendIn}s)` : 'Resend Code'}
          </button>
          <button type="button" onClick={() => { void run('cancel') }} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-medium text-secondary hover:bg-panel-muted disabled:opacity-50">
            {action === 'cancel' ? 'Cancelling...' : 'Cancel'}
          </button>
        </div>
        <p className="mt-6 border-t border-edge pt-5 text-xs leading-5 text-subtle">Your session starts only after verification. Keep this tab open while you retrieve your code.</p>
      </section>
    </main>
  )
}
