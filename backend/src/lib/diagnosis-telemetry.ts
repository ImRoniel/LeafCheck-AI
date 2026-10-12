export interface DiagnosisTelemetrySnapshot {
  deviceId: string;
  timestamp: string;
  capturedAt?: string;
  temperature: number;
  humidity: number;
  soilMoisture: number | null;
  soilMoistureRaw: number | null;
  lightLux: number | null;
  simulated?: boolean;
}

export function readingIsFresh(timestamp: string, now = Date.now()): boolean {
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -60_000 && age <= 30 * 60_000;
}

/** Normalize historical raw Mongo snapshots without using the plant's current pairing. */
export function diagnosisTelemetrySnapshot(value: unknown, legacyDemoId?: string): DiagnosisTelemetrySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
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
  };
}
