import { KeyRound, PlugZap } from 'lucide-react'
import type { ProviderStatus } from '../lib/operations'
import { formatTimestamp } from '../lib/format'
import { StatusBadge } from './StatusBadge'

export function ProviderStatusCard({ provider }: { provider: ProviderStatus }) {
  return <article className="surface p-6" aria-label={provider.name}>
    <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="rounded-xl bg-panel-muted p-2.5 text-subtle"><PlugZap size={20} aria-hidden="true" /></span><h2 className="font-semibold">{provider.name}</h2></div>
      <StatusBadge tone={provider.configured ? 'warning' : 'neutral'}>{provider.configured ? 'Unverified' : 'Not configured'}</StatusBadge></div>
    <p className="mt-5 flex items-center gap-2 text-sm text-secondary"><KeyRound size={14} aria-hidden="true" />{provider.configured ? 'API key configured' : 'API key not configured'}</p>
    <p className="mt-3 min-h-12 text-xs leading-6 text-subtle">{provider.message}</p>
    <dl className="mt-5 grid grid-cols-[1fr_auto] gap-3 border-t border-edge pt-5 text-xs"><dt className="text-subtle">Provider quota</dt><dd>Unavailable</dd><dt className="text-subtle">Quota source</dt><dd>No verified source</dd><dt className="text-subtle">Observed application calls</dt><dd>{provider.observedRequests === null ? 'Unavailable' : provider.observedRequests.toLocaleString()}</dd><dt className="text-subtle">Last observation</dt><dd>{provider.lastObservedAt ? formatTimestamp(provider.lastObservedAt) : 'None recorded'}</dd></dl>
  </article>
}
