import { Router, type Request, type Response } from "express";
import type { AdminActor } from "../lib/admin-users.js";
import { readDeviceDiagnostics, readOperationalDevice, renameOperationalDevice, unlinkOperationalDevice } from "../lib/admin-device-operations.js";
import { revokeUserSessions } from "../lib/admin-session-revocation.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { resourceId } from "../lib/ownership.js";
import { requirePermission } from "../lib/permissions.js";

export const adminOperationsRouter = Router();
const actor = (req: Request, res: Response): AdminActor => ({
  actorId: res.locals.auth.user.id, sessionId: res.locals.auth.sessionId, ipAddress: req.ip,
});
const meta = () => ({ schemaVersion: 1, asOf: new Date().toISOString() });
function invalid(message: string): never { throw new HttpError(400, "INVALID_INPUT", message); }
function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > max || /[\u0000-\u001f\u007f]/u.test(value))
    invalid(`${label} must contain between 1 and ${max} characters without control characters.`);
  return value.trim();
}
function version(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    invalid("The device's updatedAt timestamp is required. Refresh the device.");
  return new Date(value);
}
function readQuery(req: Request, allowed: readonly string[]) {
  if (Number(req.get("content-length") ?? 0) > 0 || req.get("transfer-encoding")) invalid("Request body is not supported.");
  const query = new URL(req.originalUrl, "http://localhost").searchParams;
  const seen = new Set<string>();
  for (const key of query.keys()) {
    if (!allowed.includes(key) || seen.has(key)) invalid("Invalid query parameters.");
    seen.add(key);
  }
  return query;
}

adminOperationsRouter.get("/devices/:id/readings", requirePermission("devices.read"), asyncRoute(async (req, res) => {
  const query = readQuery(req, ["limit"]);
  const raw = query.get("limit") ?? "5";
  if (!/^[1-5]$/.test(raw)) invalid("Readings limit must be between 1 and 5.");
  const data = await readDeviceDiagnostics(resourceId(req.params.id), Number(raw));
  res.json({ data, meta: meta() });
}));

adminOperationsRouter.get("/devices/:id", requirePermission("devices.read"), asyncRoute(async (req, res) => {
  readQuery(req, []);
  res.json({ data: await readOperationalDevice(resourceId(req.params.id), res.locals.auth.user.role), meta: meta() });
}));

adminOperationsRouter.patch("/devices/:id", requirePermission("devices.manage"), asyncRoute(async (req, res) => {
  const id = resourceId(req.params.id);
  const data = bodyObject(req.body, ["name", "updatedAt", "reason"]);
  await renameOperationalDevice(id, text(data.name, "Device name", 80), version(data.updatedAt), text(data.reason, "Reason", 500), actor(req, res));
  res.json({ data: await readOperationalDevice(id, res.locals.auth.user.role), meta: meta() });
}));

adminOperationsRouter.post("/devices/:id/unlink", requirePermission("devices.manage"), asyncRoute(async (req, res) => {
  const id = resourceId(req.params.id);
  const data = bodyObject(req.body, ["updatedAt", "expectedPairingId", "reason"]);
  await unlinkOperationalDevice(id, resourceId(data.expectedPairingId), version(data.updatedAt), text(data.reason, "Reason", 500), actor(req, res));
  res.json({ data: await readOperationalDevice(id, res.locals.auth.user.role), meta: meta() });
}));

adminOperationsRouter.post("/users/:id/revoke-sessions", requirePermission("sessions.revoke"), asyncRoute(async (req, res) => {
  const data = bodyObject(req.body, ["reason"]);
  res.json({ data: await revokeUserSessions(resourceId(req.params.id), text(data.reason, "Reason", 500), actor(req, res)), meta: meta() });
}));
