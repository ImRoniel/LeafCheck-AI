import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function PageHeader({ title, description, icon: Icon, actions }: {
  title: string; description: string; icon: LucideIcon; actions?: ReactNode
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 hidden size-11 shrink-0 items-center justify-center rounded-xl border border-edge bg-panel text-brand sm:flex"><Icon size={22} aria-hidden="true" /></span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-secondary">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
