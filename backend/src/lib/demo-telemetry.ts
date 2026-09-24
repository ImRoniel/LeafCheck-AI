import { createHash } from "node:crypto";
import { HttpError } from "./http.js";
import { prismaPg } from "./prisma-pg.js";
import { prisma } from "./prisma.js";

export function demoDeviceId(plantId: string) {
  const hex = createHash("sha256")
    .update(`leafcheck-demo:${plantId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Fixed UTC+8 indoor day: pre-dawn minimum, 15:00 maximum, daylight 06–18.
// No randomness: the same device and end time always produce the same batch.
export function generateDemoReadings(deviceId: string, end: Date) {
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
        .update(`${deviceId}:${index}`)
        .digest("hex")
        .slice(0, 24),
      deviceId,
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
  return prismaPg.$transaction(
    async (tx) => {
      // Serialize across processes, not just requests in this Node instance.
      await tx.$queryRaw`SELECT id FROM "Plant" WHERE id = ${plantId} AND "userId" = ${userId} FOR UPDATE`;
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
      await tx.device.upsert({
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
      const readings = generateDemoReadings(deviceId, new Date());
      // Atomic replacement leaves either the previous complete batch or the new one.
      // Stable _ids provide an additional database-level duplicate guard.
      await prisma.$transaction([
        prisma.sensorReading.deleteMany({ where: { deviceId } }),
        prisma.sensorReading.createMany({ data: readings }),
      ]);
      return tx.plant.update({
        where: { id: plantId, userId },
        data: { deviceId },
      });
    },
    { timeout: 20000, maxWait: 20000 },
  );
}
