import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '../context/session'

export function LoginPage() {
  const { login, user, status, sessionError } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const signingIn = status === 'authenticating'
  const busy = signingIn || status === 'signingOut'
  const error = formError ?? sessionError

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    setFormError(null)
    try {
      await login(email, password)
      navigate('/dashboard', { replace: true })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setFormError(cause instanceof Error ? cause.message : 'Unable to sign in. Please try again.')
    }
  }

  if (user) return <Navigate to="/dashboard" replace />

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section aria-labelledby="login-heading" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <span aria-hidden="true" className="mb-6 flex size-11 items-center justify-center rounded-xl bg-emerald-800 text-sm font-bold text-white">LC</span>
        <p className="text-sm font-semibold text-emerald-800">LeafCheck AI Administration</p>
        <h1 id="login-heading" className="mt-3 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Welcome back. Sign in to manage your platform.</p>

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
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
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
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
            />
          </div>
          {error && <p id="login-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60">
            {signingIn ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-500">Access is limited to SuperAdmin and Lead_Dev accounts.</p>
      </section>
    </main>
  )
}
