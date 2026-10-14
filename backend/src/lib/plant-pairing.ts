import type { Prisma } from "../generated/postgres-client/index.js";
import { HttpError } from "./http.js";
import { ownedDevice, ownedPlant, resourceId } from "./ownership.js";
import { prismaPg } from "./prisma-pg.js";
import { isPairingConflict, prismaErrorCode, serializableTransaction } from "./serializable.js";

type PairingTransaction = Pick<Prisma.TransactionClient, "plant" | "device" | "devicePairingHistory">;

/** The caller owns the Serializable transaction; never open a nested transaction. */
export async function pairPlantDeviceInTransaction(
  tx: PairingTransaction,
  plantId: string,
  userId: string,
  deviceId: string | null,
) {
  const plant = await ownedPlant(plantId, userId, tx);
  if (deviceId !== null) await ownedDevice(deviceId, userId, tx);
  const affected = { OR: [{ plantId }, ...(deviceId === null ? [] : [{ deviceId }])] };
  const open = await tx.devicePairingHistory.findMany({
    where: { ...affected, unpairedAt: null },
  });
  const existing = open.find(session => session.plantId === plantId && session.deviceId === deviceId);
  if (plant.deviceId === deviceId) {
    if (deviceId === null && open.length === 0) return { plant, pairing: null };
    if (existing && open.length === 1) return { plant, pairing: existing };
  }

  // Clamp the clock to both open starts and the latest closed boundary. This
  // keeps transitions nondecreasing across requests/processes if clocks drift.
  const latestClosed = await tx.devicePairingHistory.findFirst({
    where: { ...affected, unpairedAt: { not: null } },
    orderBy: { unpairedAt: "desc" },
    select: { unpairedAt: true },
  });
  const t = new Date(Math.max(Date.now(), latestClosed?.unpairedAt?.getTime() ?? 0,
    ...open.map(session => session.pairedAt.getTime())));
  await tx.devicePairingHistory.updateMany({
    where: { ...affected, unpairedAt: null },
    data: { unpairedAt: t },
  });
  if (deviceId !== null) {
    // Read the holders through the write predicate even when none exist.
    // Serializable isolation and native uniqueness prevent double claims.
    await tx.plant.updateMany({
      where: { deviceId, id: { not: plantId } },
      data: { deviceId: null },
    });
  }
  const updated = await tx.plant.update({ where: { id: plantId, userId }, data: { deviceId } });
  const pairing = deviceId === null ? null : await tx.devicePairingHistory.create({
    data: { deviceId, plantId, pairedAt: t },
  });
  return { plant: updated, pairing };
}

export async function pairPlantDevice(
  plantId: string,
  userId: string,
  deviceId: string | null,
  client: Pick<typeof prismaPg, "$transaction"> = prismaPg,
) {
  resourceId(plantId);
  if (deviceId !== null) resourceId(deviceId);
  try {
    const result = await serializableTransaction(client,
      tx => pairPlantDeviceInTransaction(tx, plantId, userId, deviceId), isPairingConflict);
    return result.plant;
  } catch (error: unknown) {
    if (prismaErrorCode(error) === "P2025") throw new HttpError(404, "NOT_FOUND", "Plant not found.");
    throw error;
  }
}
