import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, KeyRound } from 'lucide-react'
import { useSession } from '../context/session'
import { ApiError } from '../lib/api'
import { FieldError } from '../components/FieldError'
import { PageHeader } from '../components/PageHeader'

type PasswordField = 'currentPassword' | 'newPassword' | 'confirmNewPassword'
type FieldErrors = Partial<Record<PasswordField, string>>
const fields: { key: PasswordField; label: string; autoComplete: string }[] = [
  { key: 'currentPassword', label: 'Current Password', autoComplete: 'current-password' },
  { key: 'newPassword', label: 'New Password', autoComplete: 'new-password' },
  { key: 'confirmNewPassword', label: 'Confirm New Password', autoComplete: 'new-password' },
]

export function ChangePasswordPage() {
  const { changePassword } = useSession()
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirmNewPassword: '' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!success) return
    const timer = window.setTimeout(() => setSuccess(false), 6000)
    return () => window.clearTimeout(timer)
  }, [success])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    setError(null)
    setSuccess(false)
    const errors: FieldErrors = {}
    if (!values.currentPassword || [...values.currentPassword].length > 128) errors.currentPassword = 'Enter your current password (up to 128 characters).'
    if ([...values.newPassword].length < 8 || [...values.newPassword].length > 128) errors.newPassword = 'Password must contain 8–128 characters.'
    else if (values.newPassword === values.currentPassword) errors.newPassword = 'Choose a different new password.'
    if (values.newPassword !== values.confirmNewPassword) errors.confirmNewPassword = 'The new passwords do not match.'
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    pending.current = true
    setBusy(true)
    try {
      await changePassword(values.currentPassword, values.newPassword)
      if (mounted.current) {
        setValues({ currentPassword: '', newPassword: '', confirmNewPassword: '' })
        setSuccess(true)
      }
    } catch (cause) {
      if (mounted.current && !(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(cause instanceof Error ? cause.message : 'Unable to change your password. Please try again.')
        if (cause instanceof ApiError) setFieldErrors({ currentPassword: cause.fieldErrors.currentPassword, newPassword: cause.fieldErrors.newPassword })
      }
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <section aria-label="Change password" className="max-w-xl">
    <PageHeader title="Change Password" icon={KeyRound} description="Choose a unique password of 8–128 characters. Your other sessions will be signed out." />
    {success && <div role="status" className="notice-success fixed top-4 right-4 left-4 z-50 mx-auto max-w-lg shadow-lg">
      <CheckCircle2 size={18} aria-hidden="true" />Password updated successfully. Your other sessions have been signed out.
    </div>}
    <form onSubmit={submit} noValidate aria-busy={busy} className="surface space-y-5 p-6">
      {fields.map(({ key, label, autoComplete }) => <div key={key}>
        <label htmlFor={key} className="mb-2 block text-sm font-medium">{label}</label>
        <input id={key} name={key} type="password" autoComplete={autoComplete} required disabled={busy}
          value={values[key]} onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))}
          aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `${key}-error` : undefined} className="form-input" />
        <FieldError id={`${key}-error`} message={fieldErrors[key]} />
      </div>)}
      {error && <p role="alert" className="notice-error">{error}</p>}
      <div className="flex justify-end"><button type="submit" disabled={busy} className="button-primary">
        {busy ? 'Updating password...' : 'Update Password'}
      </button></div>
    </form>
  </section>
}
