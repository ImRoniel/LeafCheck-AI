import { isRecord } from './auth'
import { readDeviceRow, type DeviceRow } from './admin'

export interface DeviceDetails extends DeviceRow {
  updatedAt: string
  simulated: boolean
  pairing: { id: string; plantId: string; plantName: string; pairedAt: string } | null
  owner: { id: string; email: string | null; name: string | null } | null
}

export interface TelemetryReading {
  id: string
  timestamp: string
  temperatureCelsius: number | null
  humidityPercentage: number | null
  soilMoistureRaw: number | null
  lightLux: number | null
  simulated: boolean
}

export interface ProvisionRow {
  id: string
  macAddress: string
  label: string | null
  status: 'APPROVED' | 'REVOKED'
  claimedDeviceId: string | null
  createdAt: string
  updatedAt: string
  state: 'APPROVED_UNCLAIMED' | 'APPROVED_CLAIMED' | 'REVOKED'
}

export interface PlatformSettings {
  id: string
  aiScanningEnabled: boolean
  deviceClaimsEnabled: boolean
  updatedAt: string
  updatedBy: { id: string; email: string; name: string | null } | null
}

export interface ProviderStatus {
  provider: 'gemini' | 'plantnet' | 'perenual'
  name: string
  configured: boolean
  status: 'UNVERIFIED' | 'NOT_CONFIGURED'
  message: string
  quota: { source: 'unavailable'; remaining: null; limit: null; resetAt: null }
  lastObservedAt: string | null
  observedRequests: number | null
}

function invalid(): never { throw new Error('The server returned an unexpected response. Please refresh and try again.') }
function text(value: unknown): string { return typeof value === 'string' && value.trim() ? value : invalid() }
function optionalText(value: unknown): string | null { return value === null || value === undefined ? null : text(value) }
function date(value: unknown): string { const result = text(value); return Number.isFinite(Date.parse(result)) ? result : invalid() }
function numeric(value: unknown): number | null { return value === null || value === undefined ? null : typeof value === 'number' && Number.isFinite(value) ? value : invalid() }
function data(value: unknown): Record<string, unknown> { return isRecord(value) && isRecord(value.data) ? value.data : invalid() }

export function readDeviceDetails(value: unknown): DeviceDetails {
  const row = data(value)
  const pairing = row.pairing === null || row.pairing === undefined ? null : isRecord(row.pairing) ? {
    id: text(row.pairing.id), plantId: text(row.pairing.plantId), plantName: text(row.pairing.plantName), pairedAt: date(row.pairing.pairedAt),
  } : invalid()
  const owner = row.owner === null || row.owner === undefined ? null : isRecord(row.owner) ? {
    id: text(row.owner.id), email: optionalText(row.owner.email), name: optionalText(row.owner.name),
  } : invalid()
  return { ...readDeviceRow(row), updatedAt: date(row.updatedAt), simulated: row.simulated === true || row.source === 'DEMO' || row.connectionStatus === 'SIMULATED' || (typeof row.macAddress === 'string' && row.macAddress.startsWith('DEMO:')), pairing, owner }
}

export function readTelemetryReadings(value: unknown): TelemetryReading[] {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > 5) return invalid()
  return value.data.map((row: unknown) => {
    if (!isRecord(row)) return invalid()
    return { id: text(row.id), timestamp: date(row.timestamp), temperatureCelsius: numeric(row.temperatureCelsius),
      humidityPercentage: numeric(row.humidityPercentage), soilMoistureRaw: numeric(row.soilMoistureRaw),
      lightLux: numeric(row.lightLux), simulated: row.simulated === true }
  })
}

export function readProvisionRow(value: unknown): ProvisionRow {
  if (!isRecord(value) || (value.status !== 'APPROVED' && value.status !== 'REVOKED')) return invalid()
  const claimedDeviceId = optionalText(value.claimedDeviceId)
  return { id: text(value.id), macAddress: text(value.macAddress), label: optionalText(value.label), status: value.status,
    claimedDeviceId, createdAt: date(value.createdAt), updatedAt: date(value.updatedAt),
    state: value.status === 'REVOKED' ? 'REVOKED' : claimedDeviceId ? 'APPROVED_CLAIMED' : 'APPROVED_UNCLAIMED' }
}

export function readPlatformSettings(value: unknown): PlatformSettings {
  const row = data(value)
  if (typeof row.aiScanningEnabled !== 'boolean' || typeof row.deviceClaimsEnabled !== 'boolean') return invalid()
  const updatedBy = row.updatedBy === null || row.updatedBy === undefined ? null : isRecord(row.updatedBy) ? {
    id: text(row.updatedBy.id), email: text(row.updatedBy.email), name: optionalText(row.updatedBy.name),
  } : invalid()
  return { id: text(row.id), aiScanningEnabled: row.aiScanningEnabled, deviceClaimsEnabled: row.deviceClaimsEnabled, updatedAt: date(row.updatedAt), updatedBy }
}

export function readIntegrations(value: unknown): { providers: ProviderStatus[]; asOf: string } {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.meta)) return invalid()
  const providers = value.data.map((row: unknown): ProviderStatus => {
    if (!isRecord(row) || (row.provider !== 'gemini' && row.provider !== 'plantnet' && row.provider !== 'perenual') ||
      typeof row.configured !== 'boolean' || (row.status !== 'UNVERIFIED' && row.status !== 'NOT_CONFIGURED') ||
      !isRecord(row.quota) || row.quota.source !== 'unavailable' || row.quota.remaining !== null || row.quota.limit !== null || row.quota.resetAt !== null) return invalid()
    return { provider: row.provider, name: text(row.name), configured: row.configured, status: row.status, message: text(row.message),
      quota: { source: 'unavailable', remaining: null, limit: null, resetAt: null },
      lastObservedAt: row.lastObservedAt === null ? null : date(row.lastObservedAt), observedRequests: numeric(row.observedRequests) }
  })
  return { providers, asOf: date(value.meta.asOf) }
}
