export type DiagnosisTelemetrySource = "current_session" | "historical_session" | "legacy" | "none";

export interface DiagnosisMeasurementSnapshot {
  deviceId: string;
  timestamp: string;
  capturedAt?: string;
  temperature: number;
  humidity: number;
  soilMoisture: number | null;
  soilMoistureRaw: number | null;
  lightLux: number | null;
  simulated?: boolean;
  readingId?: string;
  plantId?: string;
  pairingId?: string;
  contextVersion?: 1;
  source?: Exclude<DiagnosisTelemetrySource, "none">;
}

export type DiagnosisTelemetrySnapshot = DiagnosisMeasurementSnapshot | { source: "none" };

export function readingIsFresh(timestamp: string, now = Date.now()): boolean {
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -60_000 && age <= 30 * 60_000;
}

/** Normalize historical raw Mongo snapshots without using the plant's current pairing. */
export function diagnosisTelemetrySnapshot(value: unknown, legacyDemoId?: string): DiagnosisTelemetrySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.source === "none") {
    const readingFields = ["deviceId", "timestamp", "capturedAt", "temperature", "humidity", "soilMoisture", "soilMoistureRaw", "lightLux", "lightLevel", "simulated", "readingId", "plantId", "pairingId", "contextVersion"];
    return readingFields.some(field => data[field] !== undefined) ? null : { source: "none" };
  }
  const source = data.source === undefined ? "legacy" : data.source;
  if (source !== "current_session" && source !== "historical_session" && source !== "legacy") return null;
  const uuid = (field: unknown): field is string => typeof field === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(field);
  if (data.readingId !== undefined && (typeof data.readingId !== "string" || !/^[0-9a-f]{24}$/i.test(data.readingId))) return null;
  const hasAttribution = data.plantId !== undefined || data.pairingId !== undefined || data.contextVersion !== undefined;
  // A source claim must carry its own complete attribution. Never repair it
  // using today's pairing, and never promote old MAC-only snapshots to verified.
  if (source === "legacy" ? hasAttribution
    : !uuid(data.plantId) || !uuid(data.pairingId) || data.contextVersion !== 1) return null;
  if (typeof data.deviceId !== "string" || typeof data.timestamp !== "string" || !Number.isFinite(Date.parse(data.timestamp))
    || typeof data.temperature !== "number" || !Number.isFinite(data.temperature)
    || typeof data.humidity !== "number" || !Number.isFinite(data.humidity)) return null;
  const physical = /^(?:LC-[0-9a-f]{6}|[0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5})$/i.test(data.deviceId);
  const simulated = typeof data.simulated === "boolean" ? data.simulated
    : data.deviceId.startsWith("DEMO:") || data.deviceId === legacyDemoId ? true : physical ? false : undefined;
  const numberOrNull = (field: unknown) => typeof field === "number" && Number.isFinite(field) ? field : null;
  return {
    deviceId: data.deviceId, timestamp: data.timestamp, temperature: data.temperature, humidity: data.humidity,
    ...(typeof data.capturedAt === "string" && Number.isFinite(Date.parse(data.capturedAt)) ? { capturedAt: data.capturedAt } : {}),
    soilMoisture: simulated ? numberOrNull(data.soilMoisture) : null,
    soilMoistureRaw: numberOrNull(data.soilMoistureRaw ?? (simulated === false ? data.soilMoisture : null)),
    lightLux: numberOrNull(data.lightLux ?? data.lightLevel),
    ...(simulated !== undefined ? { simulated } : {}),
    ...(typeof data.readingId === "string" ? { readingId: data.readingId } : {}),
    ...(uuid(data.plantId) && uuid(data.pairingId) ? { plantId: data.plantId, pairingId: data.pairingId, contextVersion: 1 } : {}),
    source,
  };
}
