import { useEffect, useState } from 'react'

export function useCountdown(deadline: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!deadline) return
    const update = () => setNow(Date.now())
    const initial = window.setTimeout(update, 0)
    const interval = window.setInterval(update, 1000)
    return () => { window.clearTimeout(initial); window.clearInterval(interval) }
  }, [deadline])
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}
