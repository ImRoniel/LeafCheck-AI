import { randomUUID } from "node:crypto";
import { Router } from "express";
import { serializeDevice } from "../lib/device.js";
import type { Device } from "../generated/postgres-client/index.js";
import { requireAuth } from "../lib/auth.js";
import { requireDeviceWrite } from "../lib/permissions.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { prisma } from "../lib/prisma.js";
import { serializeTelemetry } from "../lib/telemetry-payload.js";
import { prismaPg } from "../lib/prisma-pg.js";

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

/** Temporary diagnostics intentionally exclude error messages, query arguments and database URLs. */
function overviewErrorDetails(error: unknown) {
  const value = error && typeof error === "object" ? error : {};
  const safeIdentifier = (field: unknown) => typeof field === "string" && /^[A-Za-z0-9_."-]{1,120}$/.test(field) ? field : undefined;
  const meta = "meta" in value && value.meta && typeof value.meta === "object" ? value.meta : {};
  return {
    name: "name" in value ? safeIdentifier(value.name) : undefined,
    code: ("code" in value ? safeIdentifier(value.code) : undefined) ?? ("errorCode" in value ? safeIdentifier(value.errorCode) : undefined),
    model: "modelName" in meta ? safeIdentifier(meta.modelName) : undefined,
    column: "column" in meta ? safeIdentifier(meta.column) : undefined,
  };
}

/** All owned devices, including unlinked devices; telemetry errors stay local to a row. */
devicesRouter.get("/overview", asyncRoute(async (_req, res) => {
  const userId: string = res.locals.auth.user.id;
  const devices = await prismaPg.device.findMany({
    where: { userId }, orderBy: [{ name: "asc" }, { id: "asc" }],
    include: { plants: { where: { userId }, select: { id: true, name: true, minMoisture: true, maxMoisture: true } } },
  }).catch((error: unknown) => {
    console.error("[Sensor Overview] PostgreSQL inventory failed", overviewErrorDetails(error));
    throw error;
  });
  const entries: { device: ReturnType<typeof serializeDevice>; plants: { id: string; name: string }[];
    demo: boolean; readingError: boolean; telemetry: ReturnType<typeof serializeTelemetry> | null }[] = [];
  for (let offset = 0; offset < devices.length; offset += 4) {
    const batch = await Promise.all(devices.slice(offset, offset + 4).map(async device => {
      const demo = device.macAddress.startsWith("DEMO:");
      const plants = device.plants.map(plant => ({ id: plant.id, name: plant.name }));
      let stage = "mongodb-lookup";
      try {
        const reading = await prisma.sensorReading.findFirst({
          where: { deviceId: demo ? device.id : device.macAddress }, orderBy: { timestamp: "desc" },
        });
        stage = "serialize-reading";
        return { device: serializeDevice(device), plants, demo, readingError: false,
          telemetry: reading ? serializeTelemetry(reading, device.id, demo, device.plants[0]?.minMoisture, device.plants[0]?.maxMoisture) : null };
      } catch (error: unknown) {
        console.error("[Sensor Overview] Reading failed", { stage, deviceId: device.id, source: demo ? "demo" : "physical", ...overviewErrorDetails(error) });
        return { device: serializeDevice(device), plants, demo, readingError: true, telemetry: null };
      }
    }));
    entries.push(...batch);
  }
  res.json(entries);
}));

devicesRouter.post("/claim", requireDeviceWrite, asyncRoute(async (req, res) => {
  const body = bodyObject(req.body, ["macAddress", "name"]);
  if (typeof body.macAddress !== "string" ||
      !/^(?:LC-[0-9a-f]{6}|[0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5})$/i.test(body.macAddress)) {
    throw new HttpError(400, "INVALID_INPUT", "Invalid device MAC address.");
  }
  const macAddress = body.macAddress.toUpperCase();
  let name: string | undefined;
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100)
      throw new HttpError(400, "INVALID_INPUT", "name must be a non-empty string of at most 100 characters.");
    name = body.name.trim();
  }
  const userId: string = res.locals.auth.user.id;
  const reclaim = async (device: Device) => {
    if (device.userId !== userId)
      throw new HttpError(409, "DEVICE_ALREADY_CLAIMED", "Device already claimed.");
    return name === undefined ? device : prismaPg.device.update({
      where: { id: device.id, userId }, data: { name },
    });
  };
  const existing = await prismaPg.device.findUnique({ where: { macAddress } });
  if (existing) {
    res.json(serializeDevice(await reclaim(existing)));
    return;
  }
  try {
    const device = await prismaPg.device.create({
      data: { id: randomUUID(), macAddress, name: name ?? macAddress, userId, status: "OFFLINE" },
    });
    res.status(201).json(serializeDevice(device));
  } catch (error: unknown) {
    // The unique MAC constraint decides concurrent claims; inspect the winning owner.
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002")
      throw error;
    const winner = await prismaPg.device.findUnique({ where: { macAddress } });
    if (!winner) throw error;
    res.json(serializeDevice(await reclaim(winner)));
  }
}));
