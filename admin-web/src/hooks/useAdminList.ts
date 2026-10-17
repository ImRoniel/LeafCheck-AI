import { useCallback, useEffect } from 'react'
import { readAdminList } from '../lib/admin'
import { useAdminResource } from './useAdminResource'

export function useAdminList<T>(endpoint: string, readRow: (row: unknown) => T, page: number, query = '',
  options: { pageSize?: number; revealEmails?: boolean; enabled?: boolean; filters?: Readonly<Record<string, string>>; onPageChange?: (page: number) => void } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(options.pageSize ?? 25) })
  if (query) params.set('q', query)
  if (options.revealEmails) params.set('revealEmails', 'true')
  for (const [key, value] of Object.entries(options.filters ?? {})) if (value) params.set(key, value)
  const parse = useCallback((value: unknown) => readAdminList(value, readRow), [readRow])
  const resource = useAdminResource(options.enabled === false ? null : `${endpoint}?${params}`, parse)
  const onPageChange = options.onPageChange
  const lastPage = Math.max(1, resource.result?.pagination.totalPages ?? 1)
  const recover = !!resource.result && !!onPageChange && page > lastPage
  useEffect(() => { if (recover) onPageChange?.(lastPage) }, [recover, onPageChange, lastPage])
  return { ...resource, result: recover ? null : resource.result, loading: resource.loading || recover }
}
