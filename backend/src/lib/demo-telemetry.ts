import { createHash } from "node:crypto";
import { HttpError } from "./http.js";
import { prismaPg } from "./prisma-pg.js";
import { prisma } from "./prisma.js";
import { pairPlantDeviceInTransaction } from "./plant-pairing.js";
import { isPairingConflict, isUniqueConflict, prismaErrorCode, serializableTransaction } from "./serializable.js";

export function demoDeviceId(plantId: string) {
  const hex = createHash("sha256")
    .update(`leafcheck-demo:${plantId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Fixed UTC+8 indoor day: pre-dawn minimum, 15:00 maximum, daylight 06–18.
// No randomness: the same device, session and end time produce the same batch.
export function generateDemoReadings(deviceId: string, end: Date, context: { plantId: string; pairingId: string }) {
  const round = (value: number) => Math.round(value * 100) / 100;
  return Array.from({ length: 193 }, (_, index) => {
    const timestamp = new Date(end.getTime() - (192 - index) * 15 * 60_000);
    const hour = (((timestamp.getTime() / 3_600_000 + 8) % 24) + 24) % 24;
    const warmth =
      hour >= 5 && hour <= 15
        ? (1 - Math.cos((Math.PI * (hour - 5)) / 10)) / 2
        : (1 + Math.cos((Math.PI * ((hour - 15 + 24) % 24)) / 14)) / 2;
    return {
      id: createHash("sha256")
        .update(`${deviceId}:${context.pairingId}:${index}`)
        .digest("hex")
        .slice(0, 24),
      deviceId,
      plantId: context.plantId,
      pairingId: context.pairingId,
      contextVersion: 1,
      timestamp,
      temperature: round(24 + 7 * warmth),
      humidity: round(80 - 25 * warmth),
      lightLevel:
        hour > 6 && hour < 18
          ? Math.round(12000 * Math.sin((Math.PI * (hour - 6)) / 12))
          : 0,
      soilMoisture: round(64 - index * 0.12 + (index >= 112 ? 18 : 0)),
      soilMoistureRaw: null,
    };
  });
}

export async function seedDemoTelemetry(plantId: string, userId: string) {
  const resolved = await serializableTransaction(prismaPg,
    async (tx) => {
      const plant = await tx.plant.findFirst({
        where: { id: plantId, userId },
      });
      if (!plant) throw new HttpError(404, "NOT_FOUND", "Plant not found.");
      const deviceId = demoDeviceId(plantId);
      if (plant.deviceId && plant.deviceId !== deviceId)
        throw new HttpError(
          409,
          "HARDWARE_LINKED",
          "Demo readings cannot replace a linked hardware device.",
        );
      const device = await tx.device.upsert({
        where: { id: deviceId },
        create: {
          id: deviceId,
          name: "Virtual demo sensor",
          macAddress: `DEMO:${plantId}`,
          userId,
          status: "SIMULATED",
        },
        update: {},
      });
      if (device.userId !== userId || device.macAddress !== `DEMO:${plantId}`) {
        throw new HttpError(
          409,
          "DEVICE_CONFLICT",
          "Demo device association is unavailable.",
        );
      }
      const paired = await pairPlantDeviceInTransaction(tx, plantId, userId, deviceId);
      if (!paired.pairing) throw new Error("Demo pairing session was not created.");
      return { plant: paired.plant, deviceId, plantId, pairingId: paired.pairing.id };
    },
    error => isPairingConflict(error) || isUniqueConflict(error, "Device", ["id", "macAddress"]),
  );
  // These synthetic timestamps intentionally cover the preceding 48 hours;
  // explicit context is authoritative rather than a fabricated pairing start.
  const readings = generateDemoReadings(resolved.deviceId, new Date(), resolved);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // Replace only this session, leaving legacy/other-session samples intact.
      // MongoDB retries preserve the already committed PostgreSQL context.
      await prisma.$transaction([
        prisma.sensorReading.deleteMany({ where: { plantId, pairingId: resolved.pairingId } }),
        prisma.sensorReading.createMany({ data: readings }),
      ]);
      return resolved.plant;
    } catch (error: unknown) {
      const code = prismaErrorCode(error);
      if (attempt === 2 || (code !== "P2034" && code !== "P2002")) throw error;
    }
  }
  throw new Error("Demo telemetry replacement did not complete.");
}
