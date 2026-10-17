import type { Prisma, Role } from "../generated/postgres-client/index.js";
import { assertAdminVerification, securityTransaction } from "./admin-verification.js";
import { type AdminActor } from "./admin-users.js";
import { writeAudit } from "./audit.js";
import { HttpError } from "./http.js";
import { hasPermission, type Permission } from "./permissions.js";
import { pairPlantDeviceInTransaction } from "./plant-pairing.js";
import { prisma } from "./prisma.js";
import { prismaPg } from "./prisma-pg.js";

const deviceSelect = {
  id: true, name: true, macAddress: true, status: true, createdAt: true, updatedAt: true,
  user: { select: { id: true, name: true, email: true, isActive: true } },
  plants: { orderBy: { id: "asc" }, select: { id: true, name: true, healthStatus: true } },
  pairingHistory: { where: { unpairedAt: null }, orderBy: { pairedAt: "desc" }, take: 1,
    select: { id: true, plantId: true, pairedAt: true, plant: { select: { name: true } } } },
} satisfies Prisma.DeviceSelect;

const missingDevice = () => new HttpError(404, "NOT_FOUND", "Device not found.");
const staleDevice = () => new HttpError(409, "CONFLICT", "This device or its pairing changed. Refresh the device and try again.");

export async function authorizeOperation(tx: Prisma.TransactionClient, actor: AdminActor, permission: Permission) {
  const user = await tx.user.findUnique({ where: { id: actor.actorId } });
  if (!user?.isActive || !hasPermission(user.role, permission))
    throw new HttpError(403, "FORBIDDEN", "You do not have permission to perform this action.");
  await assertAdminVerification(user, actor.sessionId, tx);
  return user;
}

export async function readOperationalDevice(id: string, role: Role) {
  const device = await prismaPg.device.findUnique({ where: { id }, select: deviceSelect });
  if (!device) throw missingDevice();
  const pairing = device.pairingHistory[0];
  const demo = device.macAddress.startsWith("DEMO:");
  const details = {
    id: device.id, name: device.name, macAddress: device.macAddress, storedStatus: device.status,
    source: demo ? "DEMO" : "PHYSICAL", createdAt: device.createdAt, updatedAt: device.updatedAt,
    plants: device.plants,
    pairing: pairing ? { id: pairing.id, plantId: pairing.plantId, plantName: pairing.plant.name, pairedAt: pairing.pairedAt } : null,
    ...(role === "ADMIN" ? { owner: device.user } : {}),
  };
  try {
    const reading = await prisma.sensorReading.findFirst({
      where: { deviceId: demo ? device.id : device.macAddress }, orderBy: [{ timestamp: "desc" }, { id: "asc" }],
      select: { timestamp: true },
    });
    const age = reading ? Math.floor((Date.now() - reading.timestamp.getTime()) / 1000) : null;
    return { ...details, lastReadingAt: reading?.timestamp ?? null, readingError: false,
      connectionStatus: demo ? "SIMULATED" : age === null ? "NO_READINGS"
        : !Number.isFinite(age) || age < -60 ? "UNKNOWN" : age <= 1800 ? "ONLINE" : "OFFLINE" };
  } catch {
    return { ...details, lastReadingAt: null, readingError: true, connectionStatus: "UNKNOWN" };
  }
}

const finite = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value : null;

export async function readDeviceDiagnostics(id: string, limit: number) {
  const device = await prismaPg.device.findUnique({ where: { id }, select: { id: true, macAddress: true } });
  if (!device) throw missingDevice();
  const simulated = device.macAddress.startsWith("DEMO:");
  const rows = await prisma.sensorReading.findMany({
    where: { deviceId: simulated ? device.id : device.macAddress },
    orderBy: [{ timestamp: "desc" }, { id: "asc" }], take: limit,
    select: { id: true, timestamp: true, temperature: true, humidity: true, soilMoisture: true,
      soilMoistureRaw: true, lightLux: true, lightLevel: true },
  });
  return rows.map(row => ({ id: row.id, timestamp: row.timestamp,
    temperatureCelsius: finite(row.temperature), humidityPercentage: finite(row.humidity),
    soilMoistureRaw: finite(row.soilMoistureRaw ?? (simulated ? null : row.soilMoisture)),
    lightLux: finite(simulated ? row.lightLevel ?? row.lightLux : row.lightLux ?? row.lightLevel), simulated,
  }));
}

export async function renameOperationalDevice(id: string, name: string, expectedUpdatedAt: Date, reason: string, actor: AdminActor) {
  await securityTransaction(async tx => {
    await authorizeOperation(tx, actor, "devices.manage");
    const before = await tx.device.findUnique({ where: { id } });
    if (!before) throw missingDevice();
    if (before.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw staleDevice();
    const updated = await tx.device.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data: {
      name, updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)),
    } });
    if (updated.count !== 1) throw staleDevice();
    await writeAudit(actor, "DEVICE_RENAMED", id, { reason, before: { name: before.name }, after: { name } }, tx);
  });
}

export async function unlinkOperationalDevice(id: string, expectedPairingId: string, expectedUpdatedAt: Date, reason: string, actor: AdminActor) {
  await securityTransaction(async tx => {
    await authorizeOperation(tx, actor, "devices.manage");
    const device = await tx.device.findUnique({ where: { id } });
    if (!device) throw missingDevice();
    if (device.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw staleDevice();
    const [pairings, plants] = await Promise.all([
      tx.devicePairingHistory.findMany({ where: { deviceId: id, unpairedAt: null } }),
      tx.plant.findMany({ where: { deviceId: id }, select: { id: true, userId: true } }),
    ]);
    const pairing = pairings[0];
    if (pairings.length !== 1 || plants.length !== 1 || pairing?.id !== expectedPairingId || pairing.plantId !== plants[0]?.id)
      throw staleDevice();
    await pairPlantDeviceInTransaction(tx, pairing.plantId, plants[0]!.userId, null);
    const updated = await tx.device.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data: {
      updatedAt: new Date(Math.max(Date.now(), device.updatedAt.getTime() + 1)),
    } });
    if (updated.count !== 1) throw staleDevice();
    await writeAudit(actor, "DEVICE_UNLINKED", id, { reason,
      before: { pairingId: pairing.id, plantId: pairing.plantId }, after: { pairingId: null, plantId: null } }, tx);
  });
}
