import type { ReactNode } from 'react'
import type { Pagination } from '../lib/admin'

export function TableMessage({ columns, children }: { columns: number; children: ReactNode }) {
  return <tr><td colSpan={columns} className="px-5 py-12 text-center text-sm text-slate-500" role="status">{children}</td></tr>
}

export function RequestError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p>{message}</p>
      {retry && <button type="button" onClick={retry} className="font-semibold underline">Try again</button>}
    </div>
  )
}

export function TablePagination({ pagination, loading, onPage }: { pagination: Pagination | undefined; loading: boolean; onPage: (page: number) => void }) {
  const { page = 1, pageSize = 25, total = 0, totalPages = 0 } = pagination ?? {}
  const start = total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
      <p className="text-xs text-slate-500" aria-live="polite">{loading ? 'Loading results...' : `${start}–${Math.min(page * pageSize, total)} of ${total} results`}</p>
      <div className="flex items-center gap-3">
        <button type="button" className="button-secondary" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="text-xs text-slate-500">Page {page} of {Math.max(1, totalPages)}</span>
        <button type="button" className="button-secondary" disabled={loading || page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  )
}
