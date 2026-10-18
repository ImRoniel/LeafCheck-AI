import { useEffect, useRef } from 'react'

const inactivityMs = 5 * 60 * 1000
const activityEvents = ['pointerdown', 'keydown', 'mousemove'] as const

/** Per-tab inactivity: only trusted input extends the deadline, never API traffic. */
export function useInactivityTimeout(enabled: boolean, onTimeout: () => void | Promise<void>): void {
  const lastActivityAt = useRef(0)
  const timer = useRef<number | null>(null)
  const onTimeoutRef = useRef(onTimeout)
  useEffect(() => { onTimeoutRef.current = onTimeout }, [onTimeout])

  useEffect(() => {
    if (!enabled) return
    let active = true
    let expired = false
    lastActivityAt.current = Date.now()

    function expire(): void {
      if (!active || expired) return
      expired = true
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      void onTimeoutRef.current()
    }

    function checkDeadline(): void {
      if (!active || expired) return
      if (timer.current !== null) window.clearTimeout(timer.current)
      const remaining = inactivityMs - (Date.now() - lastActivityAt.current)
      if (remaining <= 0) expire()
      else timer.current = window.setTimeout(checkDeadline, remaining)
    }

    function recordActivity(event: Event): void {
      if (!active || expired || !event.isTrusted) return
      // Returning to an expired tab must not revive its session.
      if (Date.now() - lastActivityAt.current >= inactivityMs) expire()
      else lastActivityAt.current = Date.now()
    }

    function checkVisible(): void {
      if (document.visibilityState === 'visible') checkDeadline()
    }

    for (const event of activityEvents)
      window.addEventListener(event, recordActivity, { capture: true, passive: true })
    window.addEventListener('focus', checkDeadline)
    document.addEventListener('visibilitychange', checkVisible)
    checkDeadline()

    return () => {
      active = false
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      for (const event of activityEvents) window.removeEventListener(event, recordActivity, true)
      window.removeEventListener('focus', checkDeadline)
      document.removeEventListener('visibilitychange', checkVisible)
    }
  }, [enabled])
}
