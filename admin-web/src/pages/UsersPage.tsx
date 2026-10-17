import { useRef, useState, type FormEvent } from 'react'
import { Ban, CheckCircle2, Eye, EyeOff, Mail, Pencil, Plus, Search, ShieldCheck, Trash2, Undo2, Users } from 'lucide-react'
import { RequestError, TableMessage, TablePagination } from '../components/AdminTable'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { roleLabels, useSession } from '../context/session'
import { useAdminList } from '../hooks/useAdminList'
import { errorMessage, readUserRow, type UserRow } from '../lib/admin'
import { apiFetch } from '../lib/api'
import { initials } from '../lib/format'

type UserDialog = { kind: 'create' } | { kind: 'edit' | 'delete'; user: UserRow }
const userLabel = (row: UserRow) => row.name ?? row.email ?? row.emailMasked

export function UsersPage() {
  const { user, logout } = useSession()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [revealEmails, setRevealEmails] = useState(false)
  const [dialog, setDialog] = useState<UserDialog | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const [mutation, setMutation] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const mutationPending = useRef(false)
  const { result, loading, error, reload } = useAdminList('/admin/users', readUserRow, page, query, { revealEmails })
  const busy = mutation !== null
  const editing = dialog?.kind === 'edit' ? dialog.user : null
  const deleting = dialog?.kind === 'delete' ? dialog.user : null

  function openDialog(next: UserDialog) { setMutationError(null); setDeleteText(''); setDialog(next) }
  function closeDialog() { if (!mutationPending.current) { setDialog(null); setDeleteText(''); setMutationError(null) } }

  async function saveUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (mutationPending.current || !dialog || dialog.kind === 'delete') return
    const form = event.currentTarget
    const fields = new FormData(form)
    const creating = dialog.kind === 'create'
    const target = dialog.kind === 'edit' ? dialog.user : null
    const name = String(fields.get('name') ?? '').trim()
    const role = String(fields.get('role') ?? 'USER')
    mutationPending.current = true
    setMutation('save')
    setMutationError(null)
    setNotice(null)
    try {
      await apiFetch(dialog.kind === 'create' ? '/admin/users' : '/admin/users/' + encodeURIComponent(dialog.user.id), {
        method: creating ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creating ? {
          email: String(fields.get('email') ?? '').trim(), password: String(fields.get('password') ?? ''),
          name: name || undefined, role,
        } : { name: name || null, role }),
      })
      form.reset()
      setDialog(null)
      if (target?.id === user?.id && role !== user?.role) { await logout(); return }
      if (creating) { setPage(1); setQuery(''); setSearch('') }
      setNotice(creating ? 'User created successfully.' : 'User updated successfully.')
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
      await apiFetch('/admin/users/' + encodeURIComponent(row.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !row.isActive }),
      })
      setNotice(userLabel(row) + (row.isActive ? ' banned successfully.' : ' unbanned successfully.'))
      reload()
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setMutationError(errorMessage(cause))
    } finally { mutationPending.current = false; setMutation(null) }
  }

  async function deleteUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (mutationPending.current || !deleting || deleting.id === user?.id || deleteText !== 'DELETE') return
    mutationPending.current = true
    setMutation('delete')
    setMutationError(null)
    setNotice(null)
    try {
      await apiFetch('/admin/users/' + encodeURIComponent(deleting.id), { method: 'DELETE' })
      setDialog(null)
      setDeleteText('')
      setPage(1)
      setNotice(userLabel(deleting) + ' deleted successfully.')
      reload()
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setMutationError(errorMessage(cause))
      // A failed provider deletion leaves the account disabled; show its current state.
      reload()
    } finally { mutationPending.current = false; setMutation(null) }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setQuery(search.trim())
  }

  return (
    <section aria-label="User management">
      <PageHeader title="User Management" icon={Users} description="Manage accounts, roles, and access across your platform."
        actions={<button type="button" className="button-primary" onClick={() => openDialog({ kind: 'create' })} disabled={busy} aria-haspopup="dialog"><Plus size={17} aria-hidden="true" />Create User</button>} />
      {mutationError && !dialog && <RequestError message={mutationError} />}
      {notice && <p role="status" className="notice-success mb-5"><CheckCircle2 size={17} aria-hidden="true" />{notice}</p>}
      {error && <RequestError message={error} retry={reload} />}
      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-edge p-5">
          <form onSubmit={handleSearch} role="search" className="flex w-full max-w-md gap-2">
            <div className="relative min-w-0 flex-1"><Search size={16} aria-hidden="true" className="pointer-events-none absolute top-3 left-3 text-subtle" /><label htmlFor="user-search" className="sr-only">Search users</label>
              <input id="user-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or email" className="form-input pl-9" /></div>
            <button type="submit" className="button-secondary">Search</button>
          </form>
          <button type="button" className="button-secondary" aria-pressed={revealEmails} onClick={() => setRevealEmails(value => !value)}>{revealEmails ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}{revealEmails ? 'Hide emails' : 'Reveal emails'}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-4xl" aria-busy={loading}>
            <caption className="sr-only">Users and account access</caption>
            <thead className="border-b border-edge bg-panel-muted"><tr>{['Name', 'Email', 'Role', 'Status', 'Actions'].map(label => <th key={label} scope="col" className="table-head">{label}</th>)}</tr></thead>
            <tbody>
              {loading ? <TableMessage columns={5}>Loading users...</TableMessage> : error ? <TableMessage columns={5}>Users could not be loaded.</TableMessage> : !result?.data.length ? <TableMessage columns={5}>No users found.</TableMessage> : result.data.map(row => (
                <tr key={row.id} className="table-row">
                  <td className="table-cell"><span className="flex items-center gap-2.5"><span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-panel-muted text-[10px] font-semibold text-secondary">{initials(userLabel(row))}</span><span className="font-semibold text-foreground">{row.name ?? 'Unnamed user'}</span></span></td>
                  <td className="table-cell break-all"><span className="flex items-center gap-2"><Mail size={14} className="shrink-0 text-subtle" aria-hidden="true" />{revealEmails ? row.email ?? row.emailMasked : row.emailMasked}</span></td>
                  <td className="table-cell"><StatusBadge tone={row.role === 'ADMIN' ? 'info' : 'neutral'}>{row.role === 'USER' ? 'User' : roleLabels[row.role]}</StatusBadge></td>
                  <td className="table-cell"><StatusBadge tone={row.isActive ? 'success' : 'danger'} dot>{row.isActive ? 'Active' : 'Banned'}</StatusBadge></td>
                  <td className="table-cell">
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                      <button type="button" disabled={busy} aria-label={'Edit ' + userLabel(row)} onClick={() => openDialog({ kind: 'edit', user: row })} className="button-quiet"><Pencil size={13} aria-hidden="true" />Edit</button>
                      {row.id === user?.id ? <span className="ml-2 text-xs text-subtle">Your account</span> : <>
                        <button type="button" disabled={busy} aria-label={(row.isActive ? 'Ban ' : 'Unban ') + userLabel(row)} onClick={() => { void toggleBan(row) }} className="button-quiet">{row.isActive ? <Ban size={13} aria-hidden="true" /> : <Undo2 size={13} aria-hidden="true" />}{mutation === row.id ? 'Saving...' : row.isActive ? 'Ban' : 'Unban'}</button>
                        <button type="button" disabled={busy} aria-label={'Delete ' + userLabel(row)} onClick={() => openDialog({ kind: 'delete', user: row })} className="button-quiet text-danger-fg hover:bg-danger-bg hover:text-danger-fg"><Trash2 size={13} aria-hidden="true" />Delete</button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination pagination={result?.pagination} loading={loading} onPage={setPage} />
      </div>
      <p className="mt-3 text-xs leading-5 text-subtle">{revealEmails ? 'Full email addresses are visible to your SuperAdmin session.' : 'Email addresses are masked by default. Reveal them when you need the full address.'} <span className="sm:hidden">Swipe the table to view all columns.</span></p>

      {dialog && dialog.kind !== 'delete' && (
        <Modal title={editing ? 'Edit user' : 'Create a user'} description={editing ? 'Update the account name and role. Role changes sign out the affected account.' : 'Create an active account and choose its platform access.'} onClose={closeDialog} busy={busy}>
          <form onSubmit={saveUser} aria-busy={busy}>
            <fieldset disabled={busy} className="space-y-4">
              <div><label htmlFor="account-name" className="mb-2 block text-sm font-medium">Name {!editing && <span className="font-normal text-subtle">(optional)</span>}</label><input id="account-name" name="name" autoComplete="off" autoFocus defaultValue={editing?.name ?? ''} maxLength={100} className="form-input" /></div>
              {!editing && <>
                <div><label htmlFor="account-email" className="mb-2 block text-sm font-medium">Email</label><input id="account-email" name="email" type="email" autoComplete="off" required maxLength={254} className="form-input" /></div>
                <div><label htmlFor="account-password" className="mb-2 block text-sm font-medium">Initial password</label><input id="account-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="form-input" /></div>
              </>}
              <div><label htmlFor="account-role" className="mb-2 block text-sm font-medium">Role</label><select id="account-role" name="role" defaultValue={editing?.role ?? 'USER'} className="form-input"><option value="USER">User</option><option value="LEAD_DEV">System Administrator</option><option value="ADMIN">SuperAdmin</option></select></div>
            </fieldset>
            {editing?.id === user?.id && <p className="notice-warning mt-4">Changing your own role signs you out. The last active SuperAdmin cannot be demoted.</p>}
            <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-subtle"><ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />SuperAdmin accounts must verify an email code at sign-in.</p>
            {mutationError && <div className="mt-4"><RequestError message={mutationError} /></div>}
            <div className="mt-6 flex justify-end gap-2 border-t border-edge pt-5"><button type="button" disabled={busy} onClick={closeDialog} className="button-secondary">Cancel</button><button type="submit" disabled={busy} className="button-primary">{mutation === 'save' ? 'Saving...' : editing ? 'Save changes' : 'Create account'}</button></div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete user?" description="This permanently removes the account and its plants, devices, and related records. This cannot be undone." onClose={closeDialog} busy={busy}>
          <form onSubmit={deleteUser} aria-busy={busy}>
            <div className="mb-5 rounded-xl border border-edge bg-panel-muted p-4"><p className="font-semibold">{userLabel(deleting)}</p><p className="mt-1 break-all text-sm text-secondary">{revealEmails ? deleting.email ?? deleting.emailMasked : deleting.emailMasked}</p></div>
            <label htmlFor="delete-confirmation" className="mb-2 block text-sm">Type <strong>DELETE</strong> to confirm.</label>
            <input id="delete-confirmation" value={deleteText} onChange={event => setDeleteText(event.target.value)} autoComplete="off" autoFocus disabled={busy} className="form-input" />
            {mutationError && <div className="mt-4"><RequestError message={mutationError} /></div>}
            <div className="mt-6 flex justify-end gap-2 border-t border-edge pt-5"><button type="button" disabled={busy} onClick={closeDialog} className="button-secondary">Cancel</button><button type="submit" disabled={busy || deleteText !== 'DELETE'} className="button-danger"><Trash2 size={15} aria-hidden="true" />{mutation === 'delete' ? 'Deleting...' : 'Delete user'}</button></div>
          </form>
        </Modal>
      )}
    </section>
  )
}
