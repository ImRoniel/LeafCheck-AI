import { CheckCircle2, CircleDashed, Clock3, Layers3, PlugZap, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { RequestError } from '../components/AdminTable'
import { ProviderStatusCard } from '../components/ProviderStatusCard'
import { useAdminResource } from '../hooks/useAdminResource'
import { readIntegrations } from '../lib/operations'
import { formatTimestamp } from '../lib/format'

export function IntegrationsPage() {
  const resource = useAdminResource('/admin/integrations', readIntegrations)
  const configured = resource.result?.providers.filter(provider => provider.configured).length ?? 0
  const total = resource.result?.providers.length ?? 0
  return <section aria-label="AI and API monitor">
    <PageHeader title="AI & API Monitor" icon={PlugZap} description="Manage the services behind plant analysis, care guidance, and image hosting."
      actions={<button type="button" className="button-secondary" onClick={resource.reload} disabled={resource.loading || resource.refreshing}><RefreshCw size={15} aria-hidden="true" className={resource.refreshing ? 'animate-spin' : ''} />{resource.refreshing ? 'Checking status...' : 'Refresh status'}</button>} />
    {resource.error && <RequestError message={resource.error} retry={resource.reload} />}
    {resource.loading ? <p role="status" className="text-sm text-subtle">Loading provider status...</p> : resource.result && <>
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <article className="surface flex items-center gap-4 p-5" aria-label="Configured services"><span className="rounded-xl bg-success-bg p-3 text-success-fg"><CheckCircle2 size={21} aria-hidden="true" /></span><div><p className="text-xs text-subtle">Configured services</p><p className="mt-1 text-2xl font-semibold tracking-tight">{configured}<span className="ml-1.5 text-sm font-normal text-subtle">/ {total}</span></p></div></article>
        <article className="surface flex items-center gap-4 p-5" aria-label="Pending configuration"><span className={`rounded-xl p-3 ${total > configured ? 'bg-warning-bg text-warning-fg' : 'bg-panel-muted text-subtle'}`}><CircleDashed size={21} aria-hidden="true" /></span><div><p className="text-xs text-subtle">Pending configuration</p><p className="mt-1 text-2xl font-semibold tracking-tight">{total - configured}<span className="ml-1.5 text-sm font-normal text-subtle">services</span></p></div></article>
        <article className="surface flex min-w-0 items-center gap-4 p-5" aria-label="Last status check"><span className="rounded-xl bg-panel-muted p-3 text-secondary"><Clock3 size={21} aria-hidden="true" /></span><div><p className="text-xs text-subtle">Last checked</p><time dateTime={resource.result.asOf} className="mt-2 block text-sm font-semibold">{formatTimestamp(resource.result.asOf)}</time></div></article>
      </div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Layers3 size={16} className="text-brand" aria-hidden="true" />Service integrations</h2><p className="mt-1.5 text-xs text-subtle">Configuration readiness across your platform.</p></div><p className="text-xs text-subtle">{configured === total ? 'All services configured' : `${total - configured} ${total - configured === 1 ? 'service needs' : 'services need'} configuration`}</p></div>
      <div className="grid items-stretch gap-5 sm:grid-cols-2 2xl:grid-cols-4">{resource.result.providers.map(provider => <ProviderStatusCard key={provider.provider} provider={provider} />)}</div>
      <p className="mt-5 text-xs leading-6 text-subtle">Configured indicates that the service settings checked by this monitor are present. Refresh checks configuration; live provider health and quota usage are managed separately.</p>
      {resource.error && <p className="mt-2 text-xs text-subtle">Showing the last successful configuration check.</p>}
    </>}
  </section>
}
