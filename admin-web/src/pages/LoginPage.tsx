import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '../context/session'
import { ApiError } from '../lib/api'
import { useCountdown } from '../hooks/useCountdown'

export function LoginPage() {
  const { login, user, status, sessionError, challenge } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const retryIn = useCountdown(retryAt)
  const signingIn = status === 'authenticating'
  const busy = signingIn || status === 'signingOut'
  const error = formError ?? sessionError

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy || retryIn > 0) return
    setFormError(null)
    try {
      const result = await login(email, password)
      setPassword('')
      navigate(result.status === 'otp_required' ? '/login/otp' : '/dashboard', { replace: true })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (cause instanceof ApiError && cause.status === 429) {
        setRetryAt(Date.now() + Math.max(60, cause.retryAfter ?? 60) * 1000)
        setFormError(null)
        return
      }
      setFormError(cause instanceof Error ? cause.message : 'Unable to sign in. Please try again.')
    }
  }

  if (user) return <Navigate to="/dashboard" replace />
  if (challenge && status === 'otp_required') return <Navigate to="/login/otp" replace />

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section aria-labelledby="login-heading" className="w-full max-w-md rounded-2xl border border-edge bg-panel p-8 shadow-sm">
        <span aria-hidden="true" className="mb-6 flex size-11 items-center justify-center rounded-xl bg-emerald-800 text-sm font-bold text-white">LC</span>
        <p className="text-sm font-semibold text-brand">LeafCheck AI Administration</p>
        <h1 id="login-heading" className="mt-3 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-subtle">Welcome back. Sign in to manage your platform.</p>

        <form onSubmit={handleSubmit} aria-busy={busy} aria-describedby={error ? 'login-error' : undefined} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@example.com"
              disabled={busy}
              required
              className="mt-2 w-full rounded-lg border border-edge px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={busy}
              required
              className="mt-2 w-full rounded-lg border border-edge px-3 py-2.5 text-sm"
            />
          </div>
          {error && <p id="login-error" role="alert" className="notice-error">{error}</p>}
          {retryIn > 0 && <p role="status" className="notice-warning">Please wait before requesting another code. Try again in {retryIn}s.</p>}
          <button type="submit" disabled={busy || retryIn > 0} className="w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60">
            {signingIn ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 border-t border-edge pt-5 text-xs leading-5 text-subtle">Access is limited to SuperAdmin and System Administrator accounts. SuperAdmins verify an email code before signing in.</p>
      </section>
    </main>
  )
}
