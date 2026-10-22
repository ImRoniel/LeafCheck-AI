import { Router, type Request } from "express";
import type { Prisma, DeviceProvision } from "../generated/postgres-client/index.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { requirePermission } from "../lib/permissions.js";
import { writeAudit } from "../lib/audit.js";
import { securityTransaction } from "../lib/admin-verification.js";
import { normalizeHardwareMac, platformId } from "../lib/platform-policy.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { authorizeOperation } from "../lib/admin-device-operations.js";
import { resourceId } from "../lib/ownership.js";
import { geminiModelName } from "../lib/provider-config.js";

export const adminPlatformRouter = Router();
const updater = { updatedBy: { select: { id: true, email: true, name: true } } } as const;
const invalid = (message: string): never => { throw new HttpError(400, "INVALID_INPUT", message); };
const meta = () => ({ schemaVersion: 1, asOf: new Date().toISOString() });
function validateGet(req: Request, allowed: readonly string[]) {
  if (Number(req.get("content-length") ?? 0) > 0 || req.get("transfer-encoding")) invalid("Request body is not supported.");
  const seen = new Set<string>();
  const query = new URLSearchParams(req.originalUrl.split("?")[1] ?? "");
  for (const [key] of query) {
    if (!allowed.includes(key) || seen.has(key)) invalid("Invalid query fields.");
    seen.add(key);
  }
}
function reason(value: unknown) {
  if (typeof value !== "string" || value.trim().length < 3 || value.trim().length > 500)
    return invalid("Provide a reason between 3 and 500 characters.");
  return value.trim();
}
function label(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length > 100) return invalid("Label must be at most 100 characters.");
  return value.trim() || null;
}
function version(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
    return invalid("A valid updatedAt version is required. Refresh and try again.");
  return new Date(value);
}
function provisionResponse(row: DeviceProvision) {
  return { id: row.id, macAddress: row.macAddress, label: row.label, status: row.status,
    claimedDeviceId: row.claimedDeviceId, createdAt: row.createdAt, updatedAt: row.updatedAt,
    state: row.status === "REVOKED" ? "REVOKED" : row.claimedDeviceId ? "APPROVED_CLAIMED" : "APPROVED_UNCLAIMED" };
}
function pageValue(value: unknown, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return invalid("Invalid pagination.");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > maximum) return invalid("Invalid pagination.");
  return result;
}

adminPlatformRouter.get("/devices/whitelist", requirePermission("devices.provision"), asyncRoute(async (req, res) => {
  validateGet(req, ["q", "status", "page", "pageSize"]);
  const page = pageValue(req.query.page, 1, 1_000_000), pageSize = pageValue(req.query.pageSize, 25, 100);
  if (req.query.q !== undefined && (typeof req.query.q !== "string" || req.query.q.length > 100)) invalid("Search must be at most 100 characters.");
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (req.query.status !== undefined && req.query.status !== "APPROVED" && req.query.status !== "REVOKED") invalid("Invalid provisioning status.");
  const search = { contains: q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };
  const where: Prisma.DeviceProvisionWhereInput = {
    ...(req.query.status ? { status: req.query.status as "APPROVED" | "REVOKED" } : {}),
    ...(q ? { OR: [{ macAddress: search }, { label: search }] } : {}),
  };
  const result = await prismaPg.$transaction(async tx => {
    const data = await tx.deviceProvision.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize });
    const total = await tx.deviceProvision.count({ where });
    return { data: data.map(provisionResponse), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }, { isolationLevel: "RepeatableRead" });
  res.json({ ...result, meta: meta() });
}));

adminPlatformRouter.post("/devices/whitelist", requirePermission("devices.provision"), asyncRoute(async (req, res) => {
  const body = bodyObject(req.body, ["macAddress", "label", "reason"]);
  const macAddress = normalizeHardwareMac(body.macAddress), why = reason(body.reason);
  const provisionLabel = body.label === undefined ? null : label(body.label);
  const actor = { actorId: res.locals.auth.user.id as string, sessionId: res.locals.auth.sessionId as string, ipAddress: req.ip };
  const row = await securityTransaction(async tx => {
    await authorizeOperation(tx, actor, "devices.provision");
    const existing = await tx.deviceProvision.findUnique({ where: { macAddress } });
    if (existing) throw new HttpError(409, "HARDWARE_ALREADY_REGISTERED", "This hardware is already registered. Refresh the inventory to update it.");
    // Linking a previously registered device retains its owner and entire history.
    const device = await tx.device.findUnique({ where: { macAddress }, select: { id: true, userId: true } });
    const created = await tx.deviceProvision.create({ data: { macAddress, label: provisionLabel, status: "APPROVED", claimedDeviceId: device?.userId ? device.id : null, createdById: actor.actorId } });
    await writeAudit(actor, "HARDWARE_PROVISIONED", created.id, { reason: why, before: null, after: { macAddress, label: created.label, status: created.status, claimedDeviceId: created.claimedDeviceId } }, tx);
    return created;
  }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
      throw new HttpError(409, "HARDWARE_ALREADY_REGISTERED", "This hardware is already registered. Refresh the inventory to update it.");
    throw error;
  });
  res.status(201).json({ data: provisionResponse(row), meta: meta() });
}));

adminPlatformRouter.patch("/devices/whitelist/:id", requirePermission("devices.provision"), asyncRoute(async (req, res) => {
  const body = bodyObject(req.body, ["updatedAt", "label", "status", "reason"]);
  const id = resourceId(req.params.id);
  const expected = version(body.updatedAt), why = reason(body.reason);
  if (body.label === undefined && body.status === undefined) invalid("Provide a label or status to change.");
  if (body.status !== undefined && body.status !== "APPROVED" && body.status !== "REVOKED") invalid("Invalid provisioning status.");
  const data: Prisma.DeviceProvisionUpdateManyMutationInput = {
    ...(body.label !== undefined ? { label: label(body.label) } : {}),
    ...(body.status !== undefined ? { status: body.status as "APPROVED" | "REVOKED" } : {}),
  };
  const actor = { actorId: res.locals.auth.user.id as string, sessionId: res.locals.auth.sessionId as string, ipAddress: req.ip };
  const row = await securityTransaction(async tx => {
    await authorizeOperation(tx, actor, "devices.provision");
    const before = await tx.deviceProvision.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "NOT_FOUND", "Hardware provision not found.");
    data.updatedAt = new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1));
    const changed = await tx.deviceProvision.updateMany({ where: { id: before.id, updatedAt: expected }, data });
    if (changed.count !== 1) throw new HttpError(409, "STALE_PROVISION", "This hardware was changed by another operator. Refresh and try again.");
    const after = await tx.deviceProvision.findUniqueOrThrow({ where: { id: before.id } });
    await writeAudit(actor, "HARDWARE_UPDATED", before.id, { reason: why,
      before: { label: before.label, status: before.status }, after: { label: after.label, status: after.status } }, tx);
    return after;
  });
  res.json({ data: provisionResponse(row), meta: meta() });
}));

adminPlatformRouter.get("/settings", requirePermission("settings.read"), asyncRoute(async (req, res) => {
  validateGet(req, []);
  const data = await prismaPg.platformSettings.upsert({ where: { id: platformId }, create: { id: platformId }, update: {}, include: updater });
  res.json({ data, meta: meta() });
}));

adminPlatformRouter.patch("/settings", requirePermission("settings.manage"), asyncRoute(async (req, res) => {
  const body = bodyObject(req.body, ["updatedAt", "aiScanningEnabled", "deviceClaimsEnabled", "reason"]);
  const expected = version(body.updatedAt), why = reason(body.reason);
  if (body.aiScanningEnabled === undefined && body.deviceClaimsEnabled === undefined) invalid("Provide a platform setting to change.");
  for (const flag of ["aiScanningEnabled", "deviceClaimsEnabled"]) if (body[flag] !== undefined && typeof body[flag] !== "boolean") invalid("Settings must be boolean values.");
  const actor = { actorId: res.locals.auth.user.id as string, sessionId: res.locals.auth.sessionId as string, ipAddress: req.ip };
  const data = await securityTransaction(async tx => {
    await authorizeOperation(tx, actor, "settings.manage");
    const before = await tx.platformSettings.findUnique({ where: { id: platformId } });
    if (!before) throw new HttpError(409, "STALE_SETTINGS", "Refresh settings before saving changes.");
    const changed = await tx.platformSettings.updateMany({ where: { id: platformId, updatedAt: expected }, data: {
      ...(typeof body.aiScanningEnabled === "boolean" ? { aiScanningEnabled: body.aiScanningEnabled } : {}),
      ...(typeof body.deviceClaimsEnabled === "boolean" ? { deviceClaimsEnabled: body.deviceClaimsEnabled } : {}),
      updatedById: actor.actorId, updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)),
    } });
    if (changed.count !== 1) throw new HttpError(409, "STALE_SETTINGS", "Settings changed in another session. Refresh and review the current values.");
    const after = await tx.platformSettings.findUniqueOrThrow({ where: { id: platformId }, include: updater });
    await writeAudit(actor, "SETTINGS_UPDATED", platformId, { reason: why,
      before: { aiScanningEnabled: before.aiScanningEnabled, deviceClaimsEnabled: before.deviceClaimsEnabled },
      after: { aiScanningEnabled: after.aiScanningEnabled, deviceClaimsEnabled: after.deviceClaimsEnabled } }, tx);
    return after;
  });
  res.json({ data, meta: meta() });
}));

adminPlatformRouter.get("/integrations", requirePermission("integrations.read"), asyncRoute((req, res) => {
  validateGet(req, []);
  const checkedAt = new Date().toISOString();
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() || null;
  const data = [
    { provider: "gemini", name: "Google Gemini", configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      model: geminiModelName(), cloudName: null, message: "Plant identification and health analysis." },
    { provider: "plantnet", name: "Pl@ntNet", configured: Boolean(process.env.PLANTNET_API_KEY?.trim()),
      model: null, cloudName: null, message: "Plant species identification." },
    { provider: "perenual", name: "Perenual", configured: Boolean(process.env.PERENUAL_API_KEY?.trim()),
      model: null, cloudName: null, message: "Plant care reference data." },
    { provider: "cloudinary", name: "Cloudinary", configured: Boolean(cloudName),
      model: null, cloudName, message: "Plant photo storage." },
  ].map(provider => ({ ...provider, status: provider.configured ? "CONFIGURED" : "NOT_CONFIGURED", checkedAt,
    quota: { source: "unavailable", remaining: null, limit: null, resetAt: null }, lastObservedAt: null, observedRequests: null,
  }));
  res.json({ data, meta: { schemaVersion: 1, asOf: checkedAt } });
}));
