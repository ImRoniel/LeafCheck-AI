import { useCallback } from 'react'
import { readAdminList } from '../lib/admin'
import { useAdminResource } from './useAdminResource'

export function useAdminList<T>(endpoint: string, readRow: (row: unknown) => T, page: number, query = '',
  options: { pageSize?: number; revealEmails?: boolean; enabled?: boolean } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(options.pageSize ?? 25) })
  if (query) params.set('q', query)
  if (options.revealEmails) params.set('revealEmails', 'true')
  const parse = useCallback((value: unknown) => readAdminList(value, readRow), [readRow])
  return useAdminResource(options.enabled === false ? null : `${endpoint}?${params}`, parse)
}
