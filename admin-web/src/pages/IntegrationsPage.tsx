import { PlugZap, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { RequestError } from '../components/AdminTable'
import { ProviderStatusCard } from '../components/ProviderStatusCard'
import { useAdminResource } from '../hooks/useAdminResource'
import { readIntegrations } from '../lib/operations'
import { formatTimestamp } from '../lib/format'

export function IntegrationsPage() {
  const resource = useAdminResource('/admin/integrations', readIntegrations)
  return <section aria-label="AI and API monitor">
    <PageHeader title="AI & API Monitor" icon={PlugZap} description="Safe configuration status and explicitly sourced provider quota information."
      actions={<button type="button" className="button-secondary" onClick={resource.reload} disabled={resource.loading || resource.refreshing}><RefreshCw size={15} aria-hidden="true" />Refresh status</button>} />
    <p className="notice-warning mb-5">A configured key does not confirm provider health. Quotas and call observations are unavailable until a verified source is connected. Opening this page does not run image analysis.</p>
    {resource.error && <RequestError message={resource.error} retry={resource.reload} />}
    {resource.loading ? <p role="status" className="text-sm text-subtle">Loading provider status...</p> : resource.result && <><div className="grid gap-5 xl:grid-cols-3">{resource.result.providers.map(provider => <ProviderStatusCard key={provider.provider} provider={provider} />)}</div><p className="mt-4 text-xs text-subtle">Configuration checked: {formatTimestamp(resource.result.asOf)}</p></>}
  </section>
}
