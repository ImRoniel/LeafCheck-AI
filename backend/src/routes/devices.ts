import { randomUUID } from "node:crypto";
import { Router } from "express";
import { serializeDevice } from "../lib/device.js";
import type { Device } from "../generated/postgres-client/index.js";
import { requireAuth } from "../lib/auth.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { prismaPg } from "../lib/prisma-pg.js";

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

devicesRouter.post("/claim", asyncRoute(async (req, res) => {
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
