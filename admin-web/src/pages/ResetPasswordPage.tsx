import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { FieldError } from '../components/FieldError'
import { useSession } from '../context/session'
import { useCountdown } from '../hooks/useCountdown'
import { apiFetch, ApiError } from '../lib/api'
import { isRecord } from '../lib/auth'

type Field = 'email' | 'code' | 'newPassword' | 'confirmation'

export function ResetPasswordPage() {
  const { user, status, challenge } = useSession()
  const routeState: unknown = useLocation().state
  const navigate = useNavigate()
  const [email, setEmail] = useState(() => isRecord(routeState) && typeof routeState.email === 'string' ? routeState.email : '')
  // Codes are strings throughout: converting to a number would discard leading zeros.
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [action, setAction] = useState<'reset' | 'resend' | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [deadline, setDeadline] = useState(() => isRecord(routeState) && typeof routeState.resendAt === 'number'
    && Number.isFinite(routeState.resendAt) ? routeState.resendAt : 0)
  const resendIn = useCountdown(deadline)
  const busy = action !== null
  const pending = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  function rememberDeadline(address: string, seconds: number): void {
    const resendAt = Date.now() + Math.max(60, seconds) * 1000
    setDeadline(resendAt)
    navigate('/reset-password', { replace: true, state: { email: address, resendAt } })
  }

  async function run(next: 'reset' | 'resend'): Promise<void> {
    if (pending.current || (next === 'resend' && resendIn > 0) || (next === 'reset' && uncertain)) return
    const address = email.trim().toLowerCase()
    const errors: Partial<Record<Field, string>> = {}
    if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) errors.email = 'Enter a valid email address.'
    if (next === 'reset') {
      if (!/^[0-9]{8}$/.test(code)) errors.code = 'Enter the eight-digit recovery code from your email.'
      if ([...newPassword].length < 8 || [...newPassword].length > 128) errors.newPassword = 'Password must contain 8–128 characters.'
      if (newPassword !== confirmation) errors.confirmation = 'The new passwords do not match.'
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    pending.current = true
    setAction(next)
    setError(null)
    setNotice(null)
    try {
      const response = await apiFetch(next === 'reset' ? '/auth/reset-password' : '/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, retryOnUnauthorized: false,
        body: JSON.stringify(next === 'reset' ? { email: address, code, newPassword } : { email: address }),
      })
      if (next === 'reset') {
        if (response.status !== 204) throw new Error('The password reset could not be confirmed.')
        if (mounted.current) {
          setCode(''); setNewPassword(''); setConfirmation('')
          navigate('/login', { replace: true, state: { passwordReset: true } })
        }
      } else {
        if (response.status !== 202) throw new Error('Unable to request a recovery code. Please try again.')
        const payload: unknown = await response.json()
        const delay = isRecord(payload) && typeof payload.resendAfter === 'number' && Number.isFinite(payload.resendAfter)
          ? payload.resendAfter : 60
        if (mounted.current) {
          rememberDeadline(address, delay)
          setCode(''); setUncertain(false)
          setNotice('If an eligible account exists, a new recovery code has been sent.')
        }
      }
    } catch (cause) {
      if (!mounted.current) return
      if (cause instanceof ApiError && cause.status === 429) rememberDeadline(address, cause.retryAfter ?? 60)
      if (next === 'reset' && (!(cause instanceof ApiError) || cause.status === 0 || cause.status >= 500 || cause.status === 409)) {
        setUncertain(true)
        setError('We could not confirm the reset. Your password may have changed. Try signing in with your new password, or request a fresh recovery code before trying again.')
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to complete this request. Please try again.')
        if (cause instanceof ApiError && cause.fieldErrors.newPassword) setFieldErrors({ newPassword: cause.fieldErrors.newPassword })
        // Verification can consume the code before a password-policy rejection.
        if (next === 'reset' && cause instanceof ApiError && cause.status === 400 && cause.code !== 'INVALID_CODE' && cause.code !== 'INVALID_INPUT') {
          setCode('')
          setNotice('Request a fresh recovery code before submitting another password.')
        }
      }
    } finally {
      pending.current = false
      if (mounted.current) setAction(null)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void run('reset')
  }

  if (user) return <Navigate to="/dashboard" replace />
  if (challenge && status === 'otp_required') return <Navigate to="/login/otp" replace />

  return <main className="flex min-h-screen items-center justify-center px-6 py-12">
    <section aria-labelledby="reset-heading" className="w-full max-w-md rounded-2xl border border-edge bg-panel p-8 shadow-sm">
      <p className="text-sm font-semibold text-brand">LeafCheck AI Administration</p>
      <h1 id="reset-heading" className="mt-3 text-2xl font-semibold tracking-tight">Reset password</h1>
      <p className="mt-2 text-sm leading-6 text-subtle">If an eligible account exists, a recovery code has been sent. Enter the code and your new password below.</p>
      <form onSubmit={submit} noValidate aria-busy={busy} className="mt-7 space-y-5">
        <div>
          <label htmlFor="reset-email" className="block text-sm font-medium">Email</label>
          <input id="reset-email" name="email" type="email" autoComplete="username" maxLength={254} required disabled={busy}
            value={email} onChange={event => { setEmail(event.target.value); setCode('') }} className="form-input mt-2"
            aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? 'reset-email-error' : undefined} />
          <FieldError id="reset-email-error" message={fieldErrors.email} />
        </div>
        <div>
          <label htmlFor="recovery-code" className="block text-sm font-medium">Recovery code</label>
          <input id="recovery-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required
            minLength={8} maxLength={8} pattern="[0-9]{8}" disabled={busy} value={code}
            onChange={event => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 8))} className="form-input mt-2 font-mono tracking-widest"
            aria-invalid={!!fieldErrors.code} aria-describedby={fieldErrors.code ? 'recovery-code-error' : undefined} />
          <FieldError id="recovery-code-error" message={fieldErrors.code} />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium">New password</label>
          <input id="new-password" name="newPassword" type="password" autoComplete="new-password" required disabled={busy}
            value={newPassword} onChange={event => setNewPassword(event.target.value)} className="form-input mt-2"
            aria-invalid={!!fieldErrors.newPassword} aria-describedby={fieldErrors.newPassword ? 'new-password-error' : undefined} />
          <FieldError id="new-password-error" message={fieldErrors.newPassword} />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium">Confirm new password</label>
          <input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" required disabled={busy}
            value={confirmation} onChange={event => setConfirmation(event.target.value)} className="form-input mt-2"
            aria-invalid={!!fieldErrors.confirmation} aria-describedby={fieldErrors.confirmation ? 'confirm-password-error' : undefined} />
          <FieldError id="confirm-password-error" message={fieldErrors.confirmation} />
        </div>
        {error && <p role="alert" className="notice-error">{error}</p>}
        {notice && <p role="status" className="notice-warning">{notice}</p>}
        <button type="submit" disabled={busy || uncertain} className="button-primary w-full">
          {action === 'reset' ? 'Resetting password...' : 'Reset password'}
        </button>
      </form>
      <button type="button" onClick={() => { void run('resend') }} disabled={busy || resendIn > 0} className="button-secondary mt-4 w-full">
        {action === 'resend' ? 'Sending code...' : resendIn > 0 ? `Resend code (${resendIn}s)` : 'Resend code'}
      </button>
      {!busy && <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm font-medium text-brand">
        <Link to="/forgot-password" className="hover:underline">Use a different email</Link>
        <Link to="/login" replace className="hover:underline">Back to sign in</Link>
      </div>}
    </section>
  </main>
}
