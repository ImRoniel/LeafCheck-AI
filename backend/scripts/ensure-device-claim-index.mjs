import { prisma } from "../src/lib/prisma.ts";

// Apply this additive index without replacing separately managed retention indexes.
try {
  await prisma.$runCommandRaw({
    createIndexes: "sensorReadings",
    indexes: [{
      key: { deviceId: 1, claimVersion: 1, deviceTimestamp: -1 },
      name: "sensorReadings_deviceId_claimVersion_deviceTimestamp_idx",
    }],
  });
  console.log("Device claim telemetry index is ready; existing indexes are preserved.");
} catch (error) {
  console.error("Could not create device claim telemetry index.",
    error && typeof error === "object" && "code" in error ? error.code : "unknown");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
