import type { Prisma as MongoPrisma, SensorReading } from "@prisma/client";
import type { Prisma } from "../generated/postgres-client/index.js";
import { HttpError } from "./http.js";
import { ownedDevice, ownedPlant } from "./ownership.js";
import { prismaPg } from "./prisma-pg.js";
import { serializableTransaction } from "./serializable.js";

type HistorySession = Prisma.DevicePairingHistoryGetPayload<{ include: { device: true } }>;
type SensorSource = { id: string; macAddress: string };
export interface PlantHistoryQuery { limit: number; offset: number; from?: Date; to?: Date }
export const historyOrder = [{ timestamp: "desc" }, { id: "desc" }] as const;

export async function latestPlantContext(plantId: unknown, userId: string) {
  return serializableTransaction(prismaPg, async tx => {
    const plant = await ownedPlant(plantId, userId, tx);
    if (plant.deviceId === null) return { plant, device: null, session: null };
    const device = await ownedDevice(plant.deviceId, userId, tx);
    const session = await tx.devicePairingHistory.findFirst({
      where: { plantId: plant.id, deviceId: device.id, unpairedAt: null },
    });
    // Pre-Phase A pointers have no session until re-pairing or the separately
    // reviewed backfill runs. Ingestion tags them as unpaired in the meantime.
    return { plant, device, session };
  });
}

export async function plantHistoryContext(plantId: unknown, userId: string) {
  return serializableTransaction(prismaPg, async tx => {
    // Capture before establishing the snapshot: a later move cannot widen an
    // open legacy interval past the read boundary, even if MongoDB is delayed.
    const now = new Date();
    const plant = await ownedPlant(plantId, userId, tx);
    const sessions = await tx.devicePairingHistory.findMany({
      where: { plantId: plant.id }, include: { device: true },
    });
    return { plant, sessions, now };
  });
}

const isoDate = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;
function dateBound(value: unknown, name: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !isoDate.test(value)) throw new HttpError(400, "INVALID_INPUT", `${name} must be an ISO date.`);
  const date = new Date(value), calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new HttpError(400, "INVALID_INPUT", `${name} must be a valid ISO date.`);
  }
  return date;
}

export function parsePlantHistoryQuery(query: Record<string, unknown>): PlantHistoryQuery {
  function integer(value: unknown, name: string, fallback: number, min: number, max: number) {
    if (value === undefined) return fallback;
    const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new HttpError(400, "INVALID_INPUT", `Invalid history ${name}.`);
    return number;
  }
  const from = dateBound(query.from, "from"), to = dateBound(query.to, "to");
  if (from && to && from > to) throw new HttpError(400, "INVALID_INPUT", "from must not be after to.");
  return { limit: integer(query.limit, "limit", 50, 1, 200), offset: integer(query.offset, "offset", 0, 0, 2_147_483_647), from, to };
}

function sensorKey(session: HistorySession): string {
  return session.device.macAddress.startsWith("DEMO:") ? session.device.id : session.device.macAddress;
}

/** Intervals must come from the pairing writer or a verified non-overlapping import. */
export function plantHistoryWhere(plantId: string, sessions: HistorySession[], now: Date, query: PlantHistoryQuery): MongoPrisma.SensorReadingWhereInput {
  const windows: MongoPrisma.SensorReadingWhereInput[] = sessions
    .filter(session => session.unpairedAt ? session.pairedAt < session.unpairedAt : session.pairedAt <= now)
    .map(session => ({ deviceId: sensorKey(session), timestamp: session.unpairedAt
      ? { gte: session.pairedAt, lt: session.unpairedAt } : { gte: session.pairedAt, lte: now } }));
  const branches: MongoPrisma.SensorReadingWhereInput[] = [{ plantId, contextVersion: 1 }];
  if (windows.length) branches.push({ AND: [
    { OR: [{ plantId: { isSet: false } }, { plantId: { equals: null } }] },
    { OR: [{ pairingId: { isSet: false } }, { pairingId: { equals: null } }] },
    { OR: [{ contextVersion: { isSet: false } }, { contextVersion: { equals: null } }] },
    { OR: windows },
  ] });
  // Explicit context survives moves and delayed insertion; never time-window
  // tagged readings against their session or infer ownership from a current MAC.
  return { AND: [
    { OR: branches },
    ...(query.from || query.to ? [{ timestamp: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }] : []),
  ] };
}

/** Normalize with the original device, including mixed demo/physical timelines. */
export async function additionalHistorySources(readings: SensorReading[], sessions: HistorySession[]): Promise<SensorSource[]> {
  const knownKeys = new Set(sessions.flatMap(session => [session.device.id, session.device.macAddress]));
  const knownSessions = new Set(sessions.map(session => session.id));
  const unknownKeys = [...new Set(readings
    .filter(reading => !knownKeys.has(reading.deviceId) && (!reading.pairingId || !knownSessions.has(reading.pairingId)))
    .map(reading => reading.deviceId))];
  // Tagged plant context does not depend on a surviving history row. Resolve
  // its original source in one batch rather than silently dropping eligible data.
  return unknownKeys.length ? prismaPg.device.findMany({
    where: { OR: [{ id: { in: unknownKeys } }, { macAddress: { in: unknownKeys } }] },
    select: { id: true, macAddress: true },
  }) : [];
}

export function serializePlantHistoryReading(reading: SensorReading, sessions: HistorySession[], additional: SensorSource[] = []) {
  const source = sessions.find(session => session.id === reading.pairingId)?.device
    ?? sessions.find(session => session.device.id === reading.deviceId || session.device.macAddress === reading.deviceId)?.device
    ?? additional.find(device => device.id === reading.deviceId || device.macAddress === reading.deviceId);
  if (!source) throw new Error("Plant reading has no recorded source device.");
  const isDemo = source.macAddress.startsWith("DEMO:");
  return {
    id: reading.id, deviceId: source.id, timestamp: reading.timestamp.toISOString(),
    temperature: reading.temperature, humidity: reading.humidity,
    soilMoisture: isDemo ? reading.soilMoisture ?? null : null,
    soilMoistureRaw: isDemo ? reading.soilMoistureRaw ?? null : reading.soilMoistureRaw ?? reading.soilMoisture ?? null,
    lightLevel: isDemo ? reading.lightLevel ?? null : reading.lightLux ?? reading.lightLevel ?? null,
  };
}
