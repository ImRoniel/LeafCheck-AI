import type { Prisma as MongoPrisma } from "@prisma/client";
import type { Device } from "../generated/postgres-client/index.js";

/** Versioning excludes delayed old-owner writes, even when process clocks differ. */
export function deviceTelemetryWhere(
  device: Pick<Device, "id" | "macAddress" | "claimVersion" | "claimedAt">,
  asOf: Date,
): MongoPrisma.SensorReadingWhereInput {
  if (device.macAddress.startsWith("DEMO:")) return { deviceId: device.id };
  const claimVersion = device.claimVersion ?? 0;
  return {
    deviceId: device.macAddress,
    timestamp: { ...(device.claimedAt ? { gte: device.claimedAt } : {}), lte: asOf },
    ...(claimVersion > 0 ? { claimVersion } : { OR: [
      { claimVersion: 0 }, { claimVersion: null }, { claimVersion: { isSet: false } },
    ] }),
  };
}
