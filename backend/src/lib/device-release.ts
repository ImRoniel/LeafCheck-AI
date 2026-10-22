import type { Prisma } from "../generated/postgres-client/index.js";
import { HttpError } from "./http.js";
import { ownedDevice, ownedPlant, resourceId } from "./ownership.js";
import { pairPlantDeviceInTransaction } from "./plant-pairing.js";
import { prismaPg } from "./prisma-pg.js";
import { isPairingConflict, prismaErrorCode, serializableTransaction } from "./serializable.js";

type ReleaseTransaction = Pick<Prisma.TransactionClient, "device" | "plant" | "devicePairingHistory" | "deviceProvision">;

/** Release only an owned physical device with no surviving current assignment. */
export async function releaseDeviceInTransaction(tx: ReleaseTransaction, deviceId: string, userId: string) {
  const device = await ownedDevice(deviceId, userId, tx);
  if (device.macAddress.startsWith("DEMO:"))
    throw new HttpError(400, "DEMO_DEVICE_NOT_TRANSFERABLE", "Demo sensors cannot be transferred to another account.");
  const [plant, pairing] = await Promise.all([
    tx.plant.findFirst({ where: { deviceId }, select: { id: true } }),
    tx.devicePairingHistory.findFirst({ where: { deviceId, unpairedAt: null }, select: { id: true } }),
  ]);
  if (plant || pairing)
    throw new HttpError(409, "DEVICE_STILL_PAIRED", "Unpair this sensor from its plant before releasing it.");
  await tx.device.update({ where: { id: deviceId, userId }, data: { userId: null, name: device.macAddress } });
  await tx.deviceProvision.updateMany({ where: { claimedDeviceId: deviceId }, data: { claimedDeviceId: null } });
}

export async function releaseDevice(deviceId: string, userId: string, client: Pick<typeof prismaPg, "$transaction"> = prismaPg) {
  resourceId(deviceId);
  try {
    await serializableTransaction(client, tx => releaseDeviceInTransaction(tx, deviceId, userId));
  } catch (error: unknown) {
    if (prismaErrorCode(error) === "P2025") throw new HttpError(404, "NOT_FOUND", "Device not found.");
    throw error;
  }
}

/** Public unpairing releases physical ownership; internal moves keep using the pairing helper. */
export async function unpairPlantAndReleaseDevice(plantId: string, userId: string,
  client: Pick<typeof prismaPg, "$transaction"> = prismaPg) {
  resourceId(plantId);
  try {
    return await serializableTransaction(client, async tx => {
      const plant = await ownedPlant(plantId, userId, tx);
      const device = plant.deviceId ? await ownedDevice(plant.deviceId, userId, tx) : null;
      const result = await pairPlantDeviceInTransaction(tx, plantId, userId, null);
      if (device && !device.macAddress.startsWith("DEMO:")) await releaseDeviceInTransaction(tx, device.id, userId);
      return result.plant;
    }, isPairingConflict);
  } catch (error: unknown) {
    if (prismaErrorCode(error) === "P2025") throw new HttpError(404, "NOT_FOUND", "Plant or device not found.");
    throw error;
  }
}
