import type { ReactNode } from 'react'
import type { Pagination } from '../lib/admin'
import { AlertCircle, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'

export function TableMessage({ columns, children }: { columns: number; children: ReactNode }) {
  return <tr><td colSpan={columns} className="px-5 py-14 text-center text-sm text-subtle" role="status"><Inbox size={25} className="mx-auto mb-3 opacity-50" aria-hidden="true" />{children}</td></tr>
}

export function RequestError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div role="alert" className="notice-error mb-5 flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-start gap-2"><AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />{message}</p>
      {retry && <button type="button" onClick={retry} className="font-semibold underline">Try again</button>}
    </div>
  )
}

export function TablePagination({ pagination, loading, onPage }: { pagination: Pagination | undefined; loading: boolean; onPage: (page: number) => void }) {
  const { page = 1, pageSize = 25, total = 0, totalPages = 0 } = pagination ?? {}
  const start = total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-5 py-4">
      <p className="text-xs text-subtle" aria-live="polite">{loading ? 'Loading results...' : `${start}–${Math.min(page * pageSize, total)} of ${total} results`}</p>
      <div className="flex items-center gap-3">
        <button type="button" className="button-secondary" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={14} aria-hidden="true" />Previous</button>
        <span className="text-xs text-subtle">Page {page} of {Math.max(1, totalPages)}</span>
        <button type="button" className="button-secondary" disabled={loading || page >= totalPages} onClick={() => onPage(page + 1)}>Next<ChevronRight size={14} aria-hidden="true" /></button>
      </div>
    </div>
  )
}
