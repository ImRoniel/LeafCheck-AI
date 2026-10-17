import type { Prisma } from "../generated/postgres-client/index.js";
import { asyncRoute, HttpError } from "./http.js";
import { prismaPg } from "./prisma-pg.js";

export const platformId = "platform";
const physicalMac = /^(?:LC-[0-9a-f]{6}|[0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5})$/i;

export function normalizeHardwareMac(value: unknown): string {
  if (typeof value !== "string" || !physicalMac.test(value))
    throw new HttpError(400, "INVALID_INPUT", "Invalid device MAC address.");
  return value.toUpperCase();
}

/** No cache: a settings save governs the next request on every backend instance. */
export async function assertDeviceClaimsEnabled(client: Pick<Prisma.TransactionClient, "platformSettings"> = prismaPg) {
  const settings = await client.platformSettings.findUnique({ where: { id: platformId } });
  if (settings?.deviceClaimsEnabled === false)
    throw new HttpError(503, "DEVICE_CLAIMS_DISABLED", "New device claims are temporarily disabled.");
}

export async function approvedHardware(macAddress: string, client: Pick<Prisma.TransactionClient, "deviceProvision"> = prismaPg) {
  const provision = await client.deviceProvision.findUnique({ where: { macAddress } });
  if (!provision || provision.status !== "APPROVED")
    throw new HttpError(403, "HARDWARE_NOT_APPROVED", "This hardware is not approved for device claims or telemetry uploads.");
  return provision;
}

/** Run before image retrieval/processing, cache changes, or provider calls. */
export const requireAiScanning = asyncRoute(async (_req, _res, next) => {
  const settings = await prismaPg.platformSettings.findUnique({ where: { id: platformId } });
  if (settings?.aiScanningEnabled === false)
    throw new HttpError(503, "AI_SCANNING_DISABLED", "AI scanning is temporarily disabled. Saved reports remain available.");
  next();
});
