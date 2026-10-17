import { readingIsFresh } from "./diagnosis-telemetry.js";
import { prisma } from "./prisma.js";
import { prismaPg } from "./prisma-pg.js";

export const activeDeviceWindowSeconds = 1800;

/** Domain counts are PostgreSQL snapshots; connectivity comes from MongoDB. */
export async function readAdminStats(asOf: Date) {
  const [totalUsers, totalPlants, totalAiScans, totalDevices, physicalDevices] = await prismaPg.$transaction(async tx => Promise.all([
    tx.user.count({}), tx.plant.count({}), tx.aIAnalysis.count({}), tx.device.count({}),
    tx.device.findMany({ where: { NOT: { macAddress: { startsWith: "DEMO:" } } }, select: { macAddress: true } }),
  ]), { isolationLevel: "RepeatableRead" });

  let totalActiveDevices: number | null = 0;
  let telemetryDegraded = false;
  try {
    // Bound the IN clauses and return only the latest timestamp per registered MAC.
    // Keep future samples in the maximum so clock errors cannot look online.
    for (let offset = 0; offset < physicalDevices.length; offset += 500) {
      const readings = await prisma.sensorReading.groupBy({
        by: ["deviceId"],
        where: {
          deviceId: { in: physicalDevices.slice(offset, offset + 500).map(device => device.macAddress) },
          timestamp: { gte: new Date(asOf.getTime() - activeDeviceWindowSeconds * 1000) },
        },
        _max: { timestamp: true },
      });
      totalActiveDevices += readings.filter(reading => reading._max.timestamp &&
        readingIsFresh(reading._max.timestamp.toISOString(), asOf.getTime())).length;
    }
  } catch {
    // Unknown connectivity is different from a verified count of zero.
    totalActiveDevices = null;
    telemetryDegraded = true;
  }
  return {
    data: { totalUsers, totalDevices, totalPhysicalDevices: physicalDevices.length,
      activeDevices: totalActiveDevices, totalActiveDevices, totalPlants, totalAiScans },
    meta: { freshnessWindowSeconds: activeDeviceWindowSeconds, telemetryDegraded },
  };
}
