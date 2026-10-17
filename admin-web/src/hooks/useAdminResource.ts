import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import { errorMessage } from '../lib/admin'

export function useAdminResource<T>(path: string | null, parse: (value: unknown) => T) {
  const [state, setState] = useState<{ key: string; result: T | null; error: string | null } | null>(null)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])
  const key = JSON.stringify([path, revision])
  const current = state?.key === key ? state : null

  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    let active = true
    void (async () => {
      try {
        const response = await apiFetch(path, { signal: controller.signal })
        const payload: unknown = await response.json()
        const result = parse(payload)
        if (active) setState({ key, result, error: null })
      } catch (cause) {
        if (active && !controller.signal.aborted) setState({ key, result: null, error: errorMessage(cause) })
      }
    })()
    return () => { active = false; controller.abort() }
  }, [path, parse, key])

  return { result: path ? current?.result ?? null : null, loading: path !== null && current === null, error: path ? current?.error ?? null : null, reload }
}
