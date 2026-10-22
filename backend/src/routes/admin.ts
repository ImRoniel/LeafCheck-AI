import { randomUUID } from "node:crypto";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import type { Prisma } from "../generated/postgres-client/index.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { diagnosisTelemetrySnapshot, readingIsFresh } from "../lib/diagnosis-telemetry.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { requireAnyPermission, requirePermission } from "../lib/permissions.js";
import { readAdminStats } from "../lib/admin-stats.js";
import { readAdminHealth } from "../lib/admin-health.js";
import { requireAdminVerification } from "../lib/admin-verification.js";
import { createAdminUser, updateAdminUser, deleteAdminUser, type AdminActor, type UpdateAdminUser } from "../lib/admin-users.js";
import { credentials, validateName } from "../lib/auth-input.js";
import { resourceId } from "../lib/ownership.js";
import { prisma } from "../lib/prisma.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { serializeTelemetry } from "../lib/telemetry-payload.js";
import { adminPlatformRouter } from "./admin-platform.js";
import { adminOperationsRouter } from "./admin-operations.js";

const identitySelect = {
  id: true, name: true, email: true, role: true, isActive: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;
const transactionOptions = { isolationLevel: "RepeatableRead" } as const;
const freshnessWindowSeconds = 1800;
const futureToleranceSeconds = 60;

type AdminContext = { requestId: string; asOf: Date };
const context = (res: Response) => res.locals.admin as AdminContext;
const meta = (res: Response) => ({ schemaVersion: 1, asOf: context(res).asOf.toISOString() });

/** Also mounted before server parsers/limiters so errors receive these headers. */
export const adminResponseHeaders: RequestHandler = (_req, res, next) => {
  res.locals.admin ??= { requestId: randomUUID(), asOf: new Date() };
  res.set("Cache-Control", "no-store");
  res.set("X-Request-ID", context(res).requestId);
  next();
};

/** Keep admin error contracts local; never expose database/provider error text. */
export const adminErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  let status = 503, code = "ADMIN_DATA_UNAVAILABLE", message = "Admin data is temporarily unavailable.";
  let fieldErrors: Readonly<Record<string, string>> | undefined;
  if (error instanceof HttpError) {
    status = error.status; code = error.code; message = error.message;
    fieldErrors = error.fieldErrors;
  } else if (error && typeof error === "object" && "type" in error) {
    if (error.type === "entity.parse.failed") {
      status = 400; code = "INVALID_INPUT"; message = "Invalid JSON.";
    } else if (error.type === "entity.too.large") {
      status = 400; code = "INVALID_INPUT"; message = "Request body too large.";
    }
  }
  res.status(status).json({ error: message, code, requestId: context(res).requestId,
    ...(fieldErrors ? { fieldErrors } : {}),
  });
};

function invalidInput(message = "Invalid query parameters."): never {
  throw new HttpError(400, "INVALID_INPUT", message);
}

function queryParams(req: Request, allowed: readonly string[]) {
  if (Number(req.get("content-length") ?? 0) > 0 || req.get("transfer-encoding")) {
    invalidInput("Request body is not supported.");
  }
  const queryStart = req.originalUrl.indexOf("?");
  const params = new URLSearchParams(queryStart < 0 ? "" : req.originalUrl.slice(queryStart + 1));
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) invalidInput();
    result[key] = value;
  }
  return result;
}

function enumValue<const T extends string>(value: string | undefined, values: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  const found = values.find(option => option === value);
  if (found === undefined) invalidInput();
  return found;
}

function booleanValue(value: string | undefined) {
  const parsed = enumValue(value, ["true", "false"]);
  return parsed === undefined ? undefined : parsed === "true";
}

function pageQuery(query: Record<string, string>) {
  const integer = (value: string | undefined, fallback: number, max: number) => {
    if (value === undefined) return fallback;
    if (!/^[0-9]+$/.test(value)) invalidInput();
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) invalidInput();
    return parsed;
  };
  const page = integer(query.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = integer(query.pageSize, 25, 100);
  const skip = (page - 1) * pageSize;
  if (!Number.isSafeInteger(skip) || skip > 2_147_483_647) invalidInput();
  const q = query.q?.trim() || undefined;
  if (q && q.length > 100) invalidInput("Search must be at most 100 characters.");
  return { page, pageSize, skip, q };
}

function listResponse<T>(res: Response, data: T[], page: { page: number; pageSize: number }, total: number, extraMeta = {}) {
  res.json({
    data,
    pagination: { page: page.page, pageSize: page.pageSize, total, totalPages: Math.ceil(total / page.pageSize) },
    meta: { ...meta(res), ...extraMeta },
  });
}

function maskedEmail(email: string) {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, 1)}***${at >= 0 ? email.slice(at) : ""}`;
}

function textSearch(q: string) {
  // PostgreSQL contains uses LIKE: keep user-supplied wildcard characters literal.
  return { contains: q.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };
}

function userWhere(query: Record<string, string>, q: string | undefined, operators = false): Prisma.UserWhereInput {
  const role = enumValue(query.role, operators ? ["ADMIN", "LEAD_DEV"] : ["USER", "ADMIN", "LEAD_DEV"]);
  return {
    role: role ?? (operators ? { in: ["ADMIN", "LEAD_DEV"] } : undefined),
    isActive: booleanValue(query.isActive),
    ...(q ? { OR: [{ email: textSearch(q) }, { name: textSearch(q) }] } : {}),
  };
}

export const adminRouter = Router();
adminRouter.use(adminResponseHeaders, requireAuth, requireAdmin, requireAdminVerification);
// Register provisioning before the parameterized device details route.
adminRouter.use(adminPlatformRouter, adminOperationsRouter);

const actor = (req: Request, res: Response): AdminActor => ({
  actorId: res.locals.auth.user.id, sessionId: res.locals.auth.sessionId, ipAddress: req.ip,
});

function roleValue(value: unknown) {
  if (value !== "USER" && value !== "ADMIN" && value !== "LEAD_DEV")
    throw new HttpError(400, "INVALID_INPUT", "Invalid user role.", { role: "Choose User, System Administrator, or SuperAdmin." });
  return value;
}

adminRouter.get("/stats", requireAnyPermission("users.read", "devices.read"), asyncRoute(async (req, res) => {
  queryParams(req, []);
  const stats = await readAdminStats(context(res).asOf);
  res.json({ data: stats.data, meta: { ...meta(res), ...stats.meta } });
}));

adminRouter.get("/health", requireAnyPermission("users.read", "devices.read"), asyncRoute(async (req, res) => {
  queryParams(req, []);
  res.json(await readAdminHealth());
}));

adminRouter.post("/users", requirePermission("users.manage"), asyncRoute(async (req, res) => {
  const data = bodyObject(req.body, ["email", "password", "name", "role", "isActive"]);
  const login = credentials({ email: data.email, password: data.password, name: data.name }, true);
  if (data.isActive !== undefined && typeof data.isActive !== "boolean") invalidInput("isActive must be a boolean.");
  const user = await createAdminUser({ ...login, name: login.name ?? null,
    role: data.role === undefined ? "USER" : roleValue(data.role), isActive: data.isActive ?? true,
  }, actor(req, res));
  res.status(201).json({ data: user, meta: meta(res) });
}));

adminRouter.patch("/users/:id", requirePermission("users.manage"), asyncRoute(async (req, res) => {
  const id = resourceId(req.params.id);
  const data = bodyObject(req.body, ["name", "role", "isActive", "updatedAt"]);
  if (typeof data.updatedAt !== "string" || !Number.isFinite(Date.parse(data.updatedAt)) ||
      new Date(data.updatedAt).toISOString() !== data.updatedAt)
    invalidInput("The user's updatedAt timestamp is required. Please refresh.");
  if (!Object.keys(data).some(key => key !== "updatedAt")) invalidInput("Provide at least one user field.");
  const change: UpdateAdminUser = {};
  if ("name" in data) change.name = validateName(data.name);
  if ("role" in data) change.role = roleValue(data.role);
  if ("isActive" in data) {
    if (typeof data.isActive !== "boolean") invalidInput("isActive must be a boolean.");
    change.isActive = data.isActive;
  }
  res.json({ data: await updateAdminUser(id, change, actor(req, res), new Date(data.updatedAt)), meta: meta(res) });
}));

adminRouter.delete("/users/:id", requirePermission("users.manage"), asyncRoute(async (req, res) => {
  bodyObject(req.body ?? {}, []);
  await deleteAdminUser(resourceId(req.params.id), actor(req, res));
  res.status(204).end();
}));

adminRouter.get("/users", requirePermission("users.read"), asyncRoute(async (req, res) => {
  const query = queryParams(req, ["page", "pageSize", "q", "role", "isActive", "sort", "order", "revealEmails"]);
  const revealEmails = booleanValue(query.revealEmails) ?? false;
  const page = pageQuery(query);
  const where = userWhere(query, page.q);
  const sort = enumValue(query.sort, ["createdAt", "updatedAt", "name", "email"]) ?? "createdAt";
  const order = enumValue(query.order, ["asc", "desc"]) ?? "desc";
  const [users, total] = await prismaPg.$transaction(async tx => Promise.all([
    tx.user.findMany({
      where, skip: page.skip, take: page.pageSize, orderBy: [{ [sort]: order }, { id: "asc" }],
      select: { ...identitySelect, _count: { select: { plants: true, devices: true, careTasks: { where: { status: "PENDING" } } } } },
    }),
    tx.user.count({ where }),
  ]), transactionOptions);
  listResponse(res, users.map(({ email, _count, ...user }) => ({
    ...user, emailMasked: maskedEmail(email), ...(revealEmails ? { email } : {}),
    counts: { plants: _count.plants, devices: _count.devices, pendingCareTasks: _count.careTasks },
  })), page, total);
}));

adminRouter.get("/users/:id", requirePermission("users.read"), asyncRoute(async (req, res) => {
  queryParams(req, []);
  const id = resourceId(req.params.id);
  const asOf = context(res).asOf;
  const data = await prismaPg.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id }, select: identitySelect });
    if (!user) throw new HttpError(404, "NOT_FOUND", "User not found.");
    const owner = { userId: id };
    const analysesWhere = { plant: owner };
    const [plants, devices, analyses, tasks, plantTotal, deviceTotal, analysisTotal, taskTotal,
      pending, completed, skipped, active, revoked, expired] = await Promise.all([
      tx.plant.findMany({ where: owner, take: 10, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: {
        id: true, name: true, species: true, location: true, healthStatus: true, deviceId: true,
        imageUrl: true, lastScannedAt: true, updatedAt: true,
      } }),
      tx.device.findMany({ where: owner, take: 10, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: {
        id: true, name: true, macAddress: true, status: true, updatedAt: true,
      } }),
      tx.aIAnalysis.findMany({ where: analysesWhere, take: 10, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: {
        id: true, plantId: true, healthStatus: true, rawAnalysisText: true, telemetrySnapshot: true, createdAt: true,
      } }),
      tx.careTask.findMany({ where: owner, take: 10, orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: {
        id: true, plantId: true, title: true, status: true, urgency: true, dueDate: true, completedAt: true,
      } }),
      tx.plant.count({ where: owner }), tx.device.count({ where: owner }),
      tx.aIAnalysis.count({ where: analysesWhere }), tx.careTask.count({ where: owner }),
      tx.careTask.count({ where: { ...owner, status: "PENDING" } }),
      tx.careTask.count({ where: { ...owner, status: "COMPLETED" } }),
      tx.careTask.count({ where: { ...owner, status: "SKIPPED" } }),
      tx.authSession.count({ where: { ...owner, revokedAt: null, expiresAt: { gt: asOf } } }),
      tx.authSession.count({ where: { ...owner, revokedAt: { not: null } } }),
      tx.authSession.count({ where: { ...owner, revokedAt: null, expiresAt: { lte: asOf } } }),
    ]);
    const collection = <T>(items: T[], total: number) => ({ items, total, truncated: total > items.length });
    return {
      user,
      counts: { plants: plantTotal, devices: deviceTotal, analyses: analysisTotal,
        careTasks: { pending, completed, skipped }, sessions: { active, revoked, expired } },
      plants: collection(plants.map(({ imageUrl, ...plant }) => ({ ...plant, imageAvailable: Boolean(imageUrl) })), plantTotal),
      devices: collection(devices.map(({ status, ...device }) => ({ ...device, storedStatus: status,
        source: device.macAddress.startsWith("DEMO:") ? "DEMO" : "PHYSICAL" })), deviceTotal),
      analyses: collection(analyses.map(({ rawAnalysisText, telemetrySnapshot, ...analysis }) => {
        const normalized = diagnosisTelemetrySnapshot(telemetrySnapshot);
        const snapshot = normalized?.source === "none" ? null : normalized;
        const source = snapshot?.simulated === true ? "DEMO" : snapshot?.simulated === false
          ? readingIsFresh(snapshot.timestamp, Date.parse(snapshot.capturedAt ?? analysis.createdAt.toISOString()))
            ? "PHYSICAL_FRESH" : "PHYSICAL_STALE"
          : "IMAGE_ONLY";
        return { ...analysis, diagnosisError: !rawAnalysisText?.trim(), telemetrySource: source,
          telemetryTimestamp: snapshot ? new Date(snapshot.timestamp).toISOString() : null };
      }), analysisTotal),
      careTasks: collection(tasks, taskTotal),
    };
  }, transactionOptions);
  res.json({ data, meta: meta(res) });
}));

adminRouter.get("/devices", requirePermission("devices.read"), asyncRoute(async (req, res) => {
  const query = queryParams(req, ["page", "pageSize", "q", "userId", "linked", "source", "sort", "order"]);
  const operational = res.locals.auth.user.role === "LEAD_DEV";
  if (operational && query.userId !== undefined) throw new HttpError(403, "FORBIDDEN", "Filtering by owner is not permitted for this role.");
  const page = pageQuery(query);
  const linked = booleanValue(query.linked);
  const source = enumValue(query.source, ["PHYSICAL", "DEMO"]);
  const sort = enumValue(query.sort, ["name", "createdAt", "updatedAt"]) ?? "name";
  const order = enumValue(query.order, ["asc", "desc"]) ?? "asc";
  const where: Prisma.DeviceWhereInput = {
    userId: query.userId === undefined ? undefined : resourceId(query.userId),
    ...(linked === undefined ? {} : { plants: linked ? { some: {} } : { none: {} } }),
    ...(source === "DEMO" ? { macAddress: { startsWith: "DEMO:" } } : source === "PHYSICAL" ? { NOT: { macAddress: { startsWith: "DEMO:" } } } : {}),
    ...(page.q ? { OR: [{ name: textSearch(page.q) }, { macAddress: textSearch(page.q) },
      { plants: { some: { name: textSearch(page.q) } } }] } : {}),
  };
  const [devices, total] = await prismaPg.$transaction(async tx => Promise.all([
    tx.device.findMany({ where, skip: page.skip, take: page.pageSize, orderBy: [{ [sort]: order }, { id: "asc" }], select: {
      id: true, name: true, macAddress: true, status: true, createdAt: true, updatedAt: true,
      user: { select: operational ? { id: true } : { id: true, name: true, email: true, isActive: true } },
      plants: { orderBy: { id: "asc" }, select: { id: true, name: true, healthStatus: true } },
    } }),
    tx.device.count({ where }),
  ]), transactionOptions);

  // Same four-device batches, MAC/virtual-UUID join and normalization as SensorOverview.
  const readDevice = async (device: typeof devices[number]) => {
    const demo = device.macAddress.startsWith("DEMO:");
    const inventory = {
      id: device.id, name: device.name, macAddress: device.macAddress,
      ...(operational ? {} : { owner: device.user ? { id: device.user.id, name: device.user.name,
        email: device.user.email, emailMasked: maskedEmail(device.user.email), isActive: device.user.isActive } : null }),
      plants: device.plants, source: demo ? "DEMO" : "PHYSICAL", storedStatus: device.status,
      createdAt: device.createdAt, updatedAt: device.updatedAt,
    };
    try {
      const reading = await prisma.sensorReading.findFirst({
        where: { deviceId: demo ? device.id : device.macAddress }, orderBy: [{ timestamp: "desc" }, { id: "asc" }],
        select: { timestamp: true, temperature: true, humidity: true, soilMoisture: true, soilMoistureRaw: true, lightLevel: true, lightLux: true },
      });
      const normalized = reading ? serializeTelemetry(reading, device.id, demo) : null;
      const age = normalized ? Math.floor((context(res).asOf.getTime() - Date.parse(normalized.timestamp)) / 1000) : null;
      const connectionStatus = demo ? "SIMULATED" : !normalized ? "NO_READINGS"
        : age === null || !Number.isFinite(age) || age < -futureToleranceSeconds ? "UNKNOWN"
        : readingIsFresh(normalized.timestamp, context(res).asOf.getTime()) ? "ONLINE" : "OFFLINE";
      return { ...inventory, connectionStatus, lastReadingAt: normalized?.timestamp ?? null,
        readingAgeSeconds: age, readingError: false,
        telemetry: normalized ? {
          temperatureCelsius: normalized.environment.temperatureCelsius, humidityPercentage: normalized.environment.humidityPercentage,
          soilMoisturePercentage: normalized.soilMoisture.percentage, soilMoistureRaw: normalized.soilMoisture.rawAnalogValue,
          lightLux: normalized.lightLevel.lux,
        } : null };
    } catch {
      return { ...inventory, connectionStatus: "UNKNOWN", lastReadingAt: null, readingAgeSeconds: null, readingError: true, telemetry: null };
    }
  };
  const data: Awaited<ReturnType<typeof readDevice>>[] = [];
  for (let offset = 0; offset < devices.length; offset += 4) {
    data.push(...await Promise.all(devices.slice(offset, offset + 4).map(readDevice)));
  }
  listResponse(res, data, page, total, { freshnessWindowSeconds, futureToleranceSeconds, telemetryDegraded: data.some(device => device.readingError) });
}));

adminRouter.get("/admins", requirePermission("users.read"), asyncRoute(async (req, res) => {
  const query = queryParams(req, ["page", "pageSize", "q", "role", "isActive"]);
  const page = pageQuery(query);
  const where = userWhere(query, page.q, true);
  const [users, total] = await prismaPg.$transaction(async tx => Promise.all([
    tx.user.findMany({ where, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: {
      ...identitySelect, _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: context(res).asOf } } } } },
    } }),
    tx.user.count({ where }),
  ]), transactionOptions);
  listResponse(res, users.map(({ email, _count, ...user }) => ({
    ...user, emailMasked: maskedEmail(email), activeSessionCount: _count.sessions,
  })), page, total);
}));

adminRouter.get("/audit", requirePermission("audit.read"), asyncRoute(async (req, res) => {
  const query = queryParams(req, ["page", "pageSize", "action", "actorId", "targetId", "from", "to"]);
  const page = pageQuery(query);
  const date = (value: string | undefined) => {
    if (value === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) invalidInput("Invalid audit date.");
    return new Date(value);
  };
  const from = date(query.from), to = date(query.to);
  if (from && to && from > to) invalidInput("Audit date range is reversed.");
  if (query.action !== undefined && !/^[A-Z][A-Z_]{0,79}$/.test(query.action)) invalidInput("Invalid audit action.");
  if (query.targetId !== undefined && (query.targetId.length < 1 || query.targetId.length > 200)) invalidInput("Invalid audit target.");
  const where: Prisma.AuditLogWhereInput = {
    action: query.action, actorId: query.actorId === undefined ? undefined : resourceId(query.actorId),
    targetId: query.targetId,
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
  };
  const [logs, total] = await prismaPg.$transaction(async tx => {
    const [entries, count] = await Promise.all([
      tx.auditLog.findMany({ where, skip: page.skip, take: page.pageSize, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: { id: true, actorId: true, actor: { select: { email: true } }, action: true,
          targetId: true, metadata: true, ipAddress: true, createdAt: true } }),
      tx.auditLog.count({ where }),
    ]);
    // targetId is deliberately not a foreign key: deleted targets retain history.
    const ids = [...new Set(entries.flatMap(entry => entry.targetId ? [entry.targetId] : []))];
    const targets = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
    const emails = new Map(targets.map(target => [target.id, target.email]));
    return [entries.map(({ actor, ...entry }) => ({
      ...entry, actorEmail: actor?.email ?? null,
      targetEmail: entry.targetId ? emails.get(entry.targetId) ?? null : null,
    })), count] as const;
  }, transactionOptions);
  listResponse(res, logs, page, total);
}));

adminRouter.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Route not found.")));
adminRouter.use(adminErrorHandler);
