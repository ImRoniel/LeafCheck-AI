import { useEffect } from 'react'

/** Poll visible tabs; refresh immediately when returning from a background tab. */
export function useAutoRefresh(reload: () => void, intervalMs = 60_000): void {
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') reload() }
    const timer = window.setInterval(refresh, intervalMs)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [reload, intervalMs])
}
