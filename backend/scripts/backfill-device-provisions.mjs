import "../src/lib/env.ts";
import { pathToFileURL } from "node:url";
import { prismaPg } from "../src/lib/prisma-pg.ts";
import { normalizeHardwareMac } from "../src/lib/platform-policy.ts";

/** Idempotent: existing revoked authorizations are never approved by this import. */
export async function backfillDeviceProvisions(client, { apply = false } = {}) {
  const devices = await client.device.findMany({ where: { NOT: { macAddress: { startsWith: "DEMO:" } } }, orderBy: { id: "asc" } });
  const summary = { physicalDevices: devices.length, created: 0, linked: 0, unchanged: 0, revokedPreserved: 0, apply };
  for (const device of devices) {
    const macAddress = normalizeHardwareMac(device.macAddress);
    if (macAddress !== device.macAddress)
      throw new Error(`Device ${device.id} has a non-normalized identifier. Review its historical telemetry before applying this backfill.`);
    const operation = async tx => {
      const current = await tx.deviceProvision.findUnique({ where: { macAddress } });
      if (current?.claimedDeviceId && current.claimedDeviceId !== device.id)
        throw new Error(`Provision ${current.id} links to an unexpected device. Resolve the conflict before continuing.`);
      if (current?.status === "REVOKED") { summary.revokedPreserved++; return; }
      if (current?.claimedDeviceId === device.id) { summary.unchanged++; return; }
      if (current) summary.linked++; else summary.created++;
      if (!apply) return;
      const after = current
        ? await tx.deviceProvision.update({ where: { id: current.id }, data: { claimedDeviceId: device.id } })
        : await tx.deviceProvision.create({ data: { macAddress, label: device.name, status: "APPROVED", claimedDeviceId: device.id } });
      await tx.auditLog.create({ data: { actorId: null, action: "HARDWARE_BACKFILLED", targetId: after.id,
        metadata: { actorId: "system:admin_features_v2", reason: "Approve existing registered physical hardware before provisioning enforcement.",
          before: current ? { status: current.status, claimedDeviceId: current.claimedDeviceId } : null,
          after: { macAddress, status: after.status, claimedDeviceId: device.id } },
      } });
    };
    if (apply) await client.$transaction(operation, { isolationLevel: "Serializable" });
    else await operation(client);
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await backfillDeviceProvisions(prismaPg, { apply: process.argv.includes("--apply") }))); }
  catch { console.error("Device provision backfill failed. No revoked authorizations were restored. Resolve identifier or registry conflicts before enabling enforcement."); process.exitCode = 1; }
  finally { await prismaPg.$disconnect(); }
}
