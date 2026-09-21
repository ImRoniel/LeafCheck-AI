import { HttpError } from "./http.js";
import { prismaPg } from "./prisma-pg.js";

export function resourceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new HttpError(400, "INVALID_INPUT", "Invalid resource ID.");
  }
  return value;
}
export async function ownedPlant(id: unknown, userId: string) {
  const plant = await prismaPg.plant.findFirst({
    where: { id: resourceId(id), userId },
  });
  if (!plant) throw new HttpError(404, "NOT_FOUND", "Plant not found.");
  return plant;
}
export async function ownedDevice(id: unknown, userId: string) {
  const device = await prismaPg.device.findFirst({
    where: { id: resourceId(id), userId },
  });
  if (!device) throw new HttpError(404, "NOT_FOUND", "Device not found.");
  return device;
}
