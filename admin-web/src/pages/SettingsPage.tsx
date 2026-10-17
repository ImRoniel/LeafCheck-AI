import { useState } from 'react'
import { LockKeyhole, RefreshCw, Settings } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { RequestError } from '../components/AdminTable'
import { ActionModal } from '../components/ActionModal'
import { useAdminResource } from '../hooks/useAdminResource'
import { apiFetch } from '../lib/api'
import { readPlatformSettings, type PlatformSettings } from '../lib/operations'
import { formatTimestamp } from '../lib/format'

function SettingSwitch({ label, hint, enabled, onChange, disabled }: { label: string; hint: string; enabled: boolean; onChange: (enabled: boolean) => void; disabled: boolean }) {
  return <label className="flex cursor-pointer items-center justify-between gap-5 border-b border-edge py-5 last:border-b-0">
    <span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs leading-5 text-subtle">{hint}</span></span>
    <span className="relative inline-flex shrink-0"><input type="checkbox" role="switch" checked={enabled} onChange={event => onChange(event.target.checked)} disabled={disabled} aria-label={label} className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" />
      <span aria-hidden="true" className="pointer-events-none h-6 w-11 rounded-full bg-edge transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-brand peer-disabled:opacity-50" /><span aria-hidden="true" className="pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" /></span>
  </label>
}

function SettingsEditor({ settings, disabled, reload, onSaved }: { settings: PlatformSettings; disabled: boolean; reload: () => void; onSaved: () => void }) {
  const [aiScanningEnabled, setScanning] = useState(settings.aiScanningEnabled)
  const [deviceClaimsEnabled, setClaims] = useState(settings.deviceClaimsEnabled)
  const [confirming, setConfirming] = useState(false)
  const changed = aiScanningEnabled !== settings.aiScanningEnabled || deviceClaimsEnabled !== settings.deviceClaimsEnabled
  const disabling = (settings.aiScanningEnabled && !aiScanningEnabled) || (settings.deviceClaimsEnabled && !deviceClaimsEnabled)
  return <>
    <div className="surface px-6 py-2"><h2 className="mt-4 text-sm font-semibold">Platform</h2>
      <SettingSwitch label="Enable AI scanning" hint="Controls new scans across all clients. Existing reports remain readable." enabled={aiScanningEnabled} onChange={setScanning} disabled={disabled} />
      <SettingSwitch label="Allow new device claims" hint="Controls new device pairing. Existing device telemetry continues subject to hardware approval." enabled={deviceClaimsEnabled} onChange={setClaims} disabled={disabled} />
    </div>
    <div className="surface mt-5 p-6"><h2 className="mb-5 text-sm font-semibold">Security</h2>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>Staff password + email OTP</span><span className="inline-flex items-center gap-2 font-semibold text-brand"><LockKeyhole size={15} aria-hidden="true" />Required</span></div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span>OTP for all accounts</span><span className="text-subtle">Planned mobile rollout</span></div>
    </div>
    <p className="mt-5 text-xs text-subtle">Last changed{settings.updatedBy ? ` by ${settings.updatedBy.email}` : ''} · {formatTimestamp(settings.updatedAt)}</p>
    <div className="mt-6 flex justify-end gap-3"><button type="button" className="button-secondary" disabled={!changed || disabled} onClick={() => { setScanning(settings.aiScanningEnabled); setClaims(settings.deviceClaimsEnabled) }}>Discard</button>
      <button type="button" className="button-primary" disabled={!changed || disabled} onClick={() => setConfirming(true)}>Save changes</button></div>
    {confirming && <ActionModal title={disabling ? 'Disable platform services?' : 'Apply platform settings?'} description="Changes affect all application clients immediately. Confirm the changes and provide a reason."
      confirmLabel="Apply settings" danger={disabling} onClose={() => setConfirming(false)} onRefresh={() => { setConfirming(false); reload() }} onSubmit={async (reason, signal) => {
        const changes = { ...(aiScanningEnabled !== settings.aiScanningEnabled ? { aiScanningEnabled } : {}), ...(deviceClaimsEnabled !== settings.deviceClaimsEnabled ? { deviceClaimsEnabled } : {}) }
        await apiFetch('/admin/settings', { method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...changes, updatedAt: settings.updatedAt, reason }) })
        setConfirming(false)
        onSaved()
      }}><div className="rounded-xl border border-edge bg-panel-muted p-4 text-sm leading-7"><p>AI scanning: <strong>{aiScanningEnabled ? 'Enabled' : 'Disabled'}</strong></p><p>New device claims: <strong>{deviceClaimsEnabled ? 'Enabled' : 'Disabled'}</strong></p></div></ActionModal>}
  </>
}

export function SettingsPage() {
  const resource = useAdminResource('/admin/settings', readPlatformSettings)
  const [notice, setNotice] = useState<string | null>(null)
  return <section aria-label="System settings" className="max-w-4xl">
    <PageHeader title="System Settings" icon={Settings} description="Changes affect all application clients."
      actions={<button type="button" className="button-secondary" disabled={resource.loading || resource.refreshing} onClick={resource.reload}><RefreshCw size={15} aria-hidden="true" />Refresh</button>} />
    {notice && <p role="status" className="notice-success mb-5">{notice}</p>}
    {resource.error && <RequestError message={resource.error} retry={resource.reload} />}
    {resource.loading ? <p role="status" className="text-sm text-subtle">Loading settings...</p> : resource.result && <SettingsEditor key={resource.result.updatedAt} settings={resource.result} disabled={resource.refreshing || !!resource.error} reload={resource.reload} onSaved={() => { setNotice('Platform settings updated.'); resource.reload() }} />}
  </section>
}
