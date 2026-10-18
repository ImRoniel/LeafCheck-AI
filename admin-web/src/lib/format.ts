const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })

export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? dates.format(date) : 'Unavailable'
}

export function formatLastSeen(timestamp: string | null, now: number, style: 'long' | 'compact' = 'long'): string {
  if (!timestamp) return 'Never seen'
  const elapsed = now - Date.parse(timestamp)
  if (!Number.isFinite(elapsed)) return 'Unavailable'
  if (elapsed < -60_000) return 'Clock ahead'
  if (elapsed < 60_000) return style === 'compact' ? 'just now' : 'Just now'
  for (const [limit, size, unit, abbreviation] of [
    [3600_000, 60_000, 'minute', 'm'], [86_400_000, 3600_000, 'hour', 'h'],
    [2_592_000_000, 86_400_000, 'day', 'd'], [31_536_000_000, 2_592_000_000, 'month', 'mo'],
    [Infinity, 31_536_000_000, 'year', 'y'],
  ] as const) {
    if (elapsed < limit) {
      const amount = Math.floor(elapsed / size)
      return style === 'compact' ? `${amount}${abbreviation} ago` : relative.format(-amount, unit)
    }
  }
  return 'Unavailable'
}

export function formatAuditAction(action: string): string {
  const acronyms = new Set(['OTP', 'AI', 'API', 'MAC', 'ID'])
  return action.split('_').filter(Boolean).map(word => acronyms.has(word) ? word : word[0] + word.slice(1).toLowerCase()).join(' ')
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)?.[0] ?? ''}` : name.slice(0, 2)).toUpperCase()
}
