import type { Device } from "../generated/postgres-client/index.js";

export function serializeDevice(device: Device) {
  return {
    id: device.id,
    name: device.name,
    macAddress: device.macAddress,
    userId: device.userId,
    status: device.status,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}
