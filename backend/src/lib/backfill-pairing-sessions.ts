import type { PrismaClient } from "../generated/postgres-client/index.js";
import { HttpError } from "./http.js";
import { isPairingConflict, serializableTransaction } from "./serializable.js";

/** Start current pointers now; never reconstruct historical sensor ownership. */
export async function backfillOpenPairingSessions(client: Pick<PrismaClient, "$transaction">): Promise<number> {
  return serializableTransaction(client, async tx => {
    const plants = await tx.plant.findMany({
      where: { deviceId: { not: null } },
      include: { device: true, pairingHistory: { where: { unpairedAt: null } } },
    });
    const seen = new Set<string>();
    const candidates: { plantId: string; deviceId: string }[] = [];
    for (const plant of plants) {
      if (!plant.device || plant.device.userId !== plant.userId || seen.has(plant.device.id)
        || plant.pairingHistory.some(session => session.deviceId !== plant.deviceId)) {
        throw new HttpError(409, "PAIRING_CONFLICT", "Existing pairing pointers require reconciliation.");
      }
      seen.add(plant.device.id);
      if (!plant.pairingHistory.length) candidates.push({ plantId: plant.id, deviceId: plant.device.id });
    }
    if (!candidates.length) return 0;
    const conflicting = await tx.devicePairingHistory.findFirst({
      where: { deviceId: { in: candidates.map(row => row.deviceId) }, unpairedAt: null },
    });
    if (conflicting) throw new HttpError(409, "PAIRING_CONFLICT", "An existing device session requires reconciliation.");
    const pairedAt = new Date();
    const futureBoundary = await tx.devicePairingHistory.findFirst({ where: {
      OR: [{ plantId: { in: candidates.map(row => row.plantId) } }, { deviceId: { in: candidates.map(row => row.deviceId) } }],
      unpairedAt: { gt: pairedAt },
    } });
    if (futureBoundary) throw new HttpError(409, "PAIRING_CONFLICT", "A future pairing boundary requires reconciliation.");
    const result = await tx.devicePairingHistory.createMany({ data: candidates.map(row => ({ ...row, pairedAt })) });
    return result.count;
  }, isPairingConflict);
}
