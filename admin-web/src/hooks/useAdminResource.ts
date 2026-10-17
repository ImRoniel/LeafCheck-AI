import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { errorMessage } from '../lib/admin'

export function useAdminResource<T>(path: string | null, parse: (value: unknown) => T) {
  const [state, setState] = useState<{ path: string; key: string; result: T | null; error: string | null; loadedAt: string | null } | null>(null)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])
  const key = JSON.stringify([path, revision])
  // Preserve a snapshot during refresh, but never across pages, filters, or email-reveal modes.
  const current = state?.path === path ? state : null
  const pending = path !== null && state?.key !== key

  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    let active = true
    void (async () => {
      try {
        const response = await apiFetch(path, { signal: controller.signal })
        const payload: unknown = await response.json()
        const result = parse(payload)
        if (active) setState({ path, key, result, error: null, loadedAt: new Date().toISOString() })
      } catch (cause) {
        if (active && !controller.signal.aborted) setState(previous => ({ path, key,
          result: previous?.path === path ? previous.result : null,
          loadedAt: previous?.path === path ? previous.loadedAt : null, error: errorMessage(cause),
        }))
      }
    })()
    return () => { active = false; controller.abort() }
  }, [path, parse, key])

  return { result: path ? current?.result ?? null : null,
    loading: pending && !current?.result, refreshing: pending && !!current?.result,
    error: path && state?.key === key ? current?.error ?? null : null,
    updatedAt: path ? current?.loadedAt ?? null : null, reload }
}
