import type { ReactNode } from 'react'

export type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral'
const colors: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success-fg', danger: 'bg-danger-bg text-danger-fg',
  warning: 'bg-warning-bg text-warning-fg', info: 'bg-info-bg text-info-fg', neutral: 'bg-panel-muted text-secondary',
}

export function StatusBadge({ children, tone = 'neutral', dot = false }: { children: ReactNode; tone?: BadgeTone; dot?: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${colors[tone]}`}>
    {dot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}{children}
  </span>
}
