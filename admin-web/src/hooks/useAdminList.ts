import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { errorMessage, readAdminList, type AdminList } from '../lib/admin'

export function useAdminList<T>(endpoint: string, readRow: (row: unknown) => T, page: number, query = '') {
  const [state, setState] = useState<{ key: string; result: AdminList<T> | null; error: string | null } | null>(null)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])
  const key = JSON.stringify([endpoint, page, query, revision])
  const current = state?.key === key ? state : null

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (query) params.set('q', query)
    void (async () => {
      try {
        const response = await apiFetch(`${endpoint}?${params}`, { signal: controller.signal })
        const payload: unknown = await response.json()
        const list = readAdminList(payload, readRow)
        if (active) setState({ key, result: list, error: null })
      } catch (cause) {
        if (active && !controller.signal.aborted) setState({ key, result: null, error: errorMessage(cause) })
      }
    })()
    return () => { active = false; controller.abort() }
  }, [endpoint, page, query, readRow, key])

  return { result: current?.result ?? null, loading: current === null, error: current?.error ?? null, reload }
}
