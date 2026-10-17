import { useRef, useState, type FormEvent } from 'react'
import { RequestError, TableMessage, TablePagination } from '../components/AdminTable'
import { roleLabels, useSession } from '../context/session'
import { useAdminList } from '../hooks/useAdminList'
import { errorMessage, readUserRow, type UserRow } from '../lib/admin'
import { apiFetch } from '../lib/api'

export function UsersPage() {
  const { user } = useSession()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [mutation, setMutation] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const mutationPending = useRef(false)
  const { result, loading, error, reload } = useAdminList('/admin/users', readUserRow, page, query)

  async function createUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (mutationPending.current) return
    const form = event.currentTarget
    const fields = new FormData(form)
    mutationPending.current = true
    setMutation('create')
    setMutationError(null)
    setNotice(null)
    try {
      await apiFetch('/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(fields.get('email') ?? '').trim(), password: String(fields.get('password') ?? ''),
          name: String(fields.get('name') ?? '').trim() || undefined, role: String(fields.get('role') ?? 'USER') }),
      })
      form.reset()
      setCreating(false)
      setPage(1)
      setQuery('')
      setSearch('')
      setNotice('User created successfully.')
      reload()
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setMutationError(errorMessage(cause))
    } finally { mutationPending.current = false; setMutation(null) }
  }

  async function toggleBan(row: UserRow): Promise<void> {
    if (mutationPending.current || row.id === user?.id) return
    mutationPending.current = true
    setMutation(row.id)
    setMutationError(null)
    setNotice(null)
    try {
      await apiFetch(`/admin/users/${encodeURIComponent(row.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !row.isActive }),
      })
      setNotice(`${row.name ?? row.email} ${row.isActive ? 'banned' : 'unbanned'} successfully.`)
      reload()
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setMutationError(errorMessage(cause))
    } finally { mutationPending.current = false; setMutation(null) }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setQuery(search.trim())
  }

  return (
    <section aria-labelledby="users-heading">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div><h1 id="users-heading" className="text-2xl font-semibold tracking-tight">Users</h1><p className="mt-2 text-sm text-slate-500">Create accounts and manage platform access.</p></div>
        <button type="button" className="button-primary" onClick={() => { setCreating(value => !value); setMutationError(null) }} disabled={mutation !== null} aria-expanded={creating} aria-controls="create-user-form">{creating ? 'Close form' : 'Create User'}</button>
      </div>
      {mutationError && <RequestError message={mutationError} />}
      {notice && <p role="status" className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
      {creating && (
        <form id="create-user-form" onSubmit={createUser} aria-busy={mutation === 'create'} className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 font-semibold">Create a user</h2>
          <fieldset disabled={mutation !== null} className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="new-name" className="mb-2 block text-sm font-medium">Name <span className="font-normal text-slate-500">(optional)</span></label><input id="new-name" name="name" autoComplete="off" maxLength={100} className="form-input" /></div>
            <div><label htmlFor="new-email" className="mb-2 block text-sm font-medium">Email</label><input id="new-email" name="email" type="email" autoComplete="off" required maxLength={254} className="form-input" /></div>
            <div><label htmlFor="new-password" className="mb-2 block text-sm font-medium">Initial password</label><input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="form-input" /></div>
            <div><label htmlFor="new-role" className="mb-2 block text-sm font-medium">Role</label><select id="new-role" name="role" defaultValue="USER" className="form-input"><option value="USER">User</option><option value="LEAD_DEV">System Administrator</option><option value="ADMIN">SuperAdmin</option></select></div>
          </fieldset>
          <div className="mt-5 flex gap-3"><button type="submit" disabled={mutation !== null} className="button-primary">{mutation === 'create' ? 'Creating...' : 'Create account'}</button><button type="button" disabled={mutation !== null} onClick={() => setCreating(false)} className="button-secondary">Cancel</button></div>
        </form>
      )}
      <form onSubmit={handleSearch} role="search" className="mb-5 flex max-w-lg gap-2">
        <label htmlFor="user-search" className="sr-only">Search users</label>
        <input id="user-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or email" className="form-input" />
        <button type="submit" className="button-secondary">Search</button>
      </form>
      {error && <RequestError message={error} retry={reload} />}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl" aria-busy={loading}>
            <caption className="sr-only">Users and account access</caption>
            <thead className="border-b border-slate-200 bg-slate-50"><tr>{['Name', 'Email', 'Role', 'Status', 'Actions'].map(label => <th key={label} scope="col" className="table-head">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <TableMessage columns={5}>Loading users...</TableMessage> : error ? <TableMessage columns={5}>Users could not be loaded.</TableMessage> : !result?.data.length ? <TableMessage columns={5}>No users found.</TableMessage> : result.data.map(row => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="table-cell font-medium text-slate-900">{row.name ?? '—'}</td>
                  <td className="table-cell break-all">{row.email}</td>
                  <td className="table-cell whitespace-nowrap">{row.role === 'USER' ? 'User' : roleLabels[row.role]}</td>
                  <td className="table-cell"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${row.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{row.isActive ? 'Active' : 'Banned'}</span></td>
                  <td className="table-cell">{row.id === user?.id ? <span className="text-xs text-slate-400">Your account</span> : <button type="button" disabled={mutation !== null} aria-label={`${row.isActive ? 'Ban' : 'Unban'} ${row.name ?? row.email}`} onClick={() => { void toggleBan(row) }} className="button-secondary">{mutation === row.id ? 'Saving...' : row.isActive ? 'Ban' : 'Unban'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination pagination={result?.pagination} loading={loading} onPage={setPage} />
      </div>
      <p className="mt-3 text-xs text-slate-500">Email addresses are masked for privacy. <span className="sm:hidden">Swipe the table to view all columns.</span></p>
    </section>
  )
}
