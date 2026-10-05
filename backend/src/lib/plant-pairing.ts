import { HttpError } from "./http.js";
import { ownedDevice, ownedPlant, resourceId } from "./ownership.js";
import { prismaPg } from "./prisma-pg.js";

export async function pairPlantDevice(
  plantId: string,
  userId: string,
  deviceId: string | null,
  client: Pick<typeof prismaPg, "$transaction"> = prismaPg,
) {
  resourceId(plantId);
  if (deviceId !== null) resourceId(deviceId);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.$transaction(async (tx) => {
        await ownedPlant(plantId, userId, tx);
        if (deviceId !== null) {
          await ownedDevice(deviceId, userId, tx);
          // Read the holders through the write predicate even when none exist.
          // Serializable isolation prevents concurrent requests claiming two plants.
          await tx.plant.updateMany({
            where: { deviceId, id: { not: plantId } },
            data: { deviceId: null },
          });
        }
        return tx.plant.update({
          where: { id: plantId, userId },
          data: { deviceId },
        });
      }, { isolationLevel: "Serializable" });
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? error.code : undefined;
      if (code === "P2025")
        throw new HttpError(404, "NOT_FOUND", "Plant not found.");
      if (code !== "P2034") throw error;
      if (attempt === 2)
        throw new HttpError(409, "PAIRING_CONFLICT", "Pairing changed concurrently. Please try again.");
    }
  }
  // Every loop iteration returns or throws after the final conflict.
  throw new HttpError(409, "PAIRING_CONFLICT", "Pairing changed concurrently. Please try again.");
}
