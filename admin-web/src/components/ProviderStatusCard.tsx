import { Check, Clock3, CloudUpload, Gauge, KeyRound, Leaf, ScanLine, Sprout, type LucideIcon } from 'lucide-react'
import type { ProviderStatus } from '../lib/operations'
import { formatTimestamp } from '../lib/format'
import { StatusBadge } from './StatusBadge'

const services: Record<ProviderStatus['provider'], { icon: LucideIcon; purpose: string; category: string }> = {
  gemini: { icon: ScanLine, purpose: 'Scan analysis', category: 'AI diagnostics' },
  plantnet: { icon: Leaf, purpose: 'Species identification', category: 'Plant intelligence' },
  perenual: { icon: Sprout, purpose: 'Plant care data', category: 'Care guidance' },
  cloudinary: { icon: CloudUpload, purpose: 'Image hosting', category: 'Media storage' },
}

export function ProviderStatusCard({ provider }: { provider: ProviderStatus }) {
  const service = services[provider.provider]
  const Icon = service.icon
  return <article className="surface flex min-w-0 flex-col overflow-hidden" aria-label={provider.name}>
    <div className={`h-1 ${provider.configured ? 'bg-brand' : 'bg-edge'}`} aria-hidden="true" />
    <div className="flex flex-1 flex-col p-5 xl:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className={`inline-flex size-11 items-center justify-center rounded-xl ${provider.configured ? 'bg-success-bg text-success-fg' : 'bg-panel-muted text-subtle'}`}><Icon size={23} aria-hidden="true" /></span>
        <StatusBadge tone={provider.configured ? 'success' : 'neutral'}>{provider.configured && <Check size={12} aria-hidden="true" />}{provider.configured ? 'Configured' : 'Not configured'}</StatusBadge>
      </div>
      <p className="mt-5 text-[10px] font-semibold tracking-wider text-subtle uppercase">{service.category}</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">{provider.name}</h2>
      <p className="mt-1 text-sm text-secondary">{service.purpose}</p>
      <p className="mt-4 text-xs leading-6 text-subtle">{provider.message}</p>
      <dl className="mt-5 space-y-3 border-t border-edge pt-4 text-xs">
        <div className="flex items-start justify-between gap-3"><dt className="flex shrink-0 items-center gap-1.5 text-subtle"><KeyRound size={13} aria-hidden="true" />{provider.provider === 'cloudinary' ? 'Cloud configuration' : 'Credentials'}</dt><dd className={provider.configured ? 'font-medium text-success-fg' : 'text-secondary'}>{provider.configured ? 'Present' : 'Missing'}</dd></div>
        {provider.provider === 'gemini' && <div><dt className="text-subtle">Model</dt><dd className="mt-1.5 break-all rounded-md bg-panel-muted px-2.5 py-2 font-mono text-[11px] text-foreground">{provider.model ?? 'Not set'}</dd></div>}
        {provider.provider === 'cloudinary' && <div><dt className="text-subtle">Cloud name</dt><dd className="mt-1.5 break-all rounded-md bg-panel-muted px-2.5 py-2 font-mono text-[11px] text-foreground">{provider.cloudName ?? 'Not set'}</dd></div>}
      </dl>
      <div className="mt-auto pt-5"><p className="flex items-center gap-1.5 text-xs text-secondary"><Gauge size={13} aria-hidden="true" />Quota limits apply</p>
        <p className="mt-2 text-[11px] leading-5 text-subtle">Usage is managed by the provider.</p></div>
    </div>
    <div className="flex items-start gap-2 border-t border-edge bg-panel-muted px-5 py-3 text-[10px] text-subtle xl:px-6"><Clock3 size={12} className="mt-0.5 shrink-0" aria-hidden="true" /><span>Last checked <time className="mt-0.5 block" dateTime={provider.checkedAt}>{formatTimestamp(provider.checkedAt)}</time></span></div>
  </article>
}
