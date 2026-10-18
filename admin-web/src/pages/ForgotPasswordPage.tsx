import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/session'
import { useCountdown } from '../hooks/useCountdown'
import { apiFetch, ApiError } from '../lib/api'
import { isRecord } from '../lib/auth'

export function ForgotPasswordPage() {
  const { user, status, challenge } = useSession()
  const location = useLocation()
  const routeState: unknown = location.state
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => isRecord(routeState) && typeof routeState.email === 'string' ? routeState.email : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const retryIn = useCountdown(retryAt)
  const pending = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (pending.current || retryIn > 0) return
    const address = email.trim().toLowerCase()
    if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError('Enter a valid email address.')
      return
    }
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address }), retryOnUnauthorized: false,
      })
      if (response.status !== 202) throw new Error('Unable to request a recovery code. Please try again.')
      const payload: unknown = await response.json()
      const delay = isRecord(payload) && typeof payload.resendAfter === 'number' && Number.isFinite(payload.resendAfter)
        ? Math.max(60, payload.resendAfter) : 60
      if (mounted.current) navigate('/reset-password', { state: { email: address, resendAt: Date.now() + delay * 1000 } })
    } catch (cause) {
      if (!mounted.current) return
      if (cause instanceof ApiError && cause.status === 429)
        setRetryAt(Date.now() + Math.max(60, cause.retryAfter ?? 60) * 1000)
      setError(cause instanceof Error ? cause.message : 'Unable to request a recovery code. Please try again.')
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  if (user) return <Navigate to="/dashboard" replace />
  if (challenge && status === 'otp_required') return <Navigate to="/login/otp" replace />

  return <main className="flex min-h-screen items-center justify-center px-6 py-12">
    <section aria-labelledby="forgot-heading" className="w-full max-w-md rounded-2xl border border-edge bg-panel p-8 shadow-sm">
      <p className="text-sm font-semibold text-brand">LeafCheck AI Administration</p>
      <h1 id="forgot-heading" className="mt-3 text-2xl font-semibold tracking-tight">Forgot password</h1>
      <p className="mt-2 text-sm leading-6 text-subtle">Enter your email to request an eight-digit recovery code.</p>
      <form onSubmit={submit} noValidate aria-busy={busy} className="mt-7 space-y-5">
        <div>
          <label htmlFor="recovery-email" className="block text-sm font-medium">Email</label>
          <input id="recovery-email" name="email" type="email" autoComplete="username" maxLength={254} required
            value={email} onChange={event => setEmail(event.target.value)} disabled={busy} className="form-input mt-2" />
        </div>
        {error && <p role="alert" className="notice-error">{error}</p>}
        {retryIn > 0 && <p role="status" className="notice-warning">Please wait {retryIn}s before requesting another code.</p>}
        <button type="submit" disabled={busy || retryIn > 0} className="button-primary w-full">
          {busy ? 'Sending code...' : 'Send recovery code'}
        </button>
      </form>
      {!busy && <Link to="/login" replace className="mt-5 inline-block text-sm font-medium text-brand hover:underline">Back to sign in</Link>}
    </section>
  </main>
}
