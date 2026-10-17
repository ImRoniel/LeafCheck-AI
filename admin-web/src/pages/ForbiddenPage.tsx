import { Link } from 'react-router-dom'

export function ForbiddenPage() {
  return (
    <section className="rounded-2xl border border-edge bg-panel p-8">
      <p className="text-sm font-semibold text-amber-700">Access restricted</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">SuperAdmin access required</h1>
      <p className="mt-3 text-sm text-secondary">Your account can view devices. User management and audit logs are reserved for SuperAdmins.</p>
      <Link to="/devices" className="mt-6 inline-block text-sm font-semibold text-brand hover:underline">Go to devices &rarr;</Link>
    </section>
  )
}
