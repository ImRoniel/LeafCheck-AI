import { isRecord, type AuthUser } from './auth'

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminList<T> {
  data: T[]
  pagination: Pagination
  telemetryDegraded: boolean
}

export interface UserRow {
  id: string
  name: string | null
  email: string
  role: AuthUser['role']
  isActive: boolean
}

export interface DeviceRow {
  id: string
  name: string
  macAddress: string
  plants: { id: string; name: string }[]
  connectionStatus: string
}

export interface AuditRow {
  id: string
  actorId: string | null
  action: string
  targetId: string | null
  createdAt: string
  metadata: Record<string, unknown> | null
}

function invalidResponse(): never {
  throw new Error('The server returned an unexpected response. Please try again.')
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || !field.trim()) return invalidResponse()
  return field
}

function nullableString(value: Record<string, unknown>, key: string): string | null {
  if (value[key] === null) return null
  return stringField(value, key)
}

export function readAdminList<T>(value: unknown, readRow: (row: unknown) => T): AdminList<T> {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pagination)) return invalidResponse()
  const { page, pageSize, total, totalPages } = value.pagination
  for (const field of [page, pageSize, total, totalPages]) {
    if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0) return invalidResponse()
  }
  if (typeof page !== 'number' || typeof pageSize !== 'number' || typeof total !== 'number' ||
    typeof totalPages !== 'number' || page < 1 || pageSize < 1 || pageSize > 100 ||
    totalPages !== Math.ceil(total / pageSize)) return invalidResponse()
  return {
    data: value.data.map(readRow), pagination: { page, pageSize, total, totalPages },
    telemetryDegraded: isRecord(value.meta) && value.meta.telemetryDegraded === true,
  }
}

export function readUserRow(value: unknown): UserRow {
  if (!isRecord(value) || typeof value.isActive !== 'boolean' ||
    (value.role !== 'USER' && value.role !== 'ADMIN' && value.role !== 'LEAD_DEV')) return invalidResponse()
  return {
    id: stringField(value, 'id'), name: nullableString(value, 'name'),
    email: typeof value.email === 'string' ? stringField(value, 'email') : stringField(value, 'emailMasked'),
    role: value.role, isActive: value.isActive,
  }
}

export function readDeviceRow(value: unknown): DeviceRow {
  if (!isRecord(value) || !Array.isArray(value.plants)) return invalidResponse()
  return {
    id: stringField(value, 'id'), name: stringField(value, 'name'), macAddress: stringField(value, 'macAddress'),
    plants: value.plants.map((plant: unknown) => {
      if (!isRecord(plant)) return invalidResponse()
      return { id: stringField(plant, 'id'), name: stringField(plant, 'name') }
    }),
    connectionStatus: stringField(value, 'connectionStatus'),
  }
}

export function readAuditRow(value: unknown): AuditRow {
  if (!isRecord(value)) return invalidResponse()
  const createdAt = stringField(value, 'createdAt')
  if (!Number.isFinite(Date.parse(createdAt))) return invalidResponse()
  return {
    id: stringField(value, 'id'), actorId: nullableString(value, 'actorId'),
    action: stringField(value, 'action'), targetId: nullableString(value, 'targetId'), createdAt,
    metadata: isRecord(value.metadata) ? value.metadata : null,
  }
}

export function auditOutcome(row: AuditRow): string {
  if (typeof row.metadata?.outcome === 'string' && row.metadata.outcome.trim()) return row.metadata.outcome
  if (/(?:FAILED|DENIED|REJECTED)$/.test(row.action)) return 'Failed'
  if (/CANCELLED$/.test(row.action)) return 'Cancelled'
  if (/REQUESTED$/.test(row.action)) return 'Requested'
  if (/(?:VERIFIED|RESENT|CREATED|UPDATED|DELETED)$/.test(row.action)) return 'Succeeded'
  return 'Recorded'
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to complete this request. Please try again.'
}
