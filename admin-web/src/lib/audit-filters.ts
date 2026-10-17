export interface AuditFilters { action: string; from: string; to: string; actorId: string; targetId: string }
export const emptyAuditFilters: AuditFilters = { action: '', from: '', to: '', actorId: '', targetId: '' }

/** Date controls describe full calendar days in the administrator's time zone. */
export function auditFilterQuery(filters: AuditFilters) {
  const params: Record<string, string> = {}
  const errors: Partial<Record<keyof AuditFilters, string>> = {}
  const action = filters.action.trim().toUpperCase()
  if (action && !/^[A-Z][A-Z_]{0,79}$/.test(action)) errors.action = 'Use an action code such as USER_UPDATED.'
  else if (action) params.action = action
  for (const key of ['from', 'to'] as const) {
    if (!filters[key]) continue
    const date = new Date(filters[key] + (key === 'from' ? 'T00:00:00.000' : 'T23:59:59.999'))
    const calendar = Number.isFinite(date.getTime())
      ? `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || calendar !== filters[key]) errors[key] = 'Choose a valid date.'
    else params[key] = date.toISOString()
  }
  if (params.from && params.to && Date.parse(params.from) > Date.parse(params.to)) errors.to = 'To Date must be on or after From Date.'
  const actorId = filters.actorId.trim()
  if (actorId && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(actorId)) errors.actorId = 'Enter a valid actor user ID.'
  else if (actorId) params.actorId = actorId
  const targetId = filters.targetId.trim()
  if (targetId.length > 200) errors.targetId = 'Target ID must contain at most 200 characters.'
  else if (targetId) params.targetId = targetId
  return { params, errors }
}
