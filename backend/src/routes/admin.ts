import { randomUUID } from "node:crypto";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import type { Prisma } from "../generated/postgres-client/index.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";
import { diagnosisTelemetrySnapshot, readingIsFresh } from "../lib/diagnosis-telemetry.js";
import { asyncRoute, HttpError } from "../lib/http.js";
import { resourceId } from "../lib/ownership.js";
import { prisma } from "../lib/prisma.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { serializeTelemetry } from "../lib/telemetry-payload.js";

const identitySelect = {
  id: true, name: true, email: true, role: true, isActive: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;
const physicalMac = /^(?:LC-[0-9a-f]{6}|[0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5})$/i;
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
  if (error instanceof HttpError) {
    status = error.status; code = error.code; message = error.message;
  } else if (error && typeof error === "object" && "type" in error) {
    if (error.type === "entity.parse.failed") {
      status = 400; code = "INVALID_INPUT"; message = "Invalid JSON.";
    } else if (error.type === "entity.too.large") {
      status = 400; code = "INVALID_INPUT"; message = "Request body too large.";
    }
  }
  res.status(status).json({ error: message, code, requestId: context(res).requestId });
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
adminRouter.use(adminResponseHeaders, requireAuth, requireAdmin);

adminRouter.get("/users", asyncRoute(async (req, res) => {
  const query = queryParams(req, ["page", "pageSize", "q", "role", "isActive", "sort", "order"]);
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
    ...user, emailMasked: maskedEmail(email),
    counts: { plants: _count.plants, devices: _count.devices, pendingCareTasks: _count.careTasks },
  })), page, total);
}));

adminRouter.get("/users/:id", asyncRoute(async (req, res) => {
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
        const snapshot = diagnosisTelemetrySnapshot(telemetrySnapshot);
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

adminRouter.get("/devices/whitelist", asyncRoute(async (req, res) => {
  const query = queryParams(req, ["page", "pageSize", "q", "userId"]);
  const page = pageQuery(query);
  const where: Prisma.DeviceWhereInput = {
    NOT: { macAddress: { startsWith: "DEMO:" } },
    userId: query.userId === undefined ? undefined : resourceId(query.userId),
    ...(page.q ? { OR: [{ name: textSearch(page.q) }, { macAddress: textSearch(page.q) }] } : {}),
  };
  const [devices, total] = await prismaPg.$transaction(async tx => Promise.all([
    tx.device.findMany({ where, skip: page.skip, take: page.pageSize, orderBy: [{ macAddress: "asc" }, { id: "asc" }], select: {
      id: true, macAddress: true, name: true, userId: true, createdAt: true, user: { select: { isActive: true } },
    } }),
    tx.device.count({ where }),
  ]), transactionOptions);
  listResponse(res, devices.map(device => ({
    deviceId: device.id, macAddress: device.macAddress, name: device.name,
    ownerId: device.userId, ownerIsActive: device.user.isActive,
    ingestionAllowed: physicalMac.test(device.macAddress), authorizationBasis: "REGISTERED_DEVICE",
    proofOfPossessionVerified: false, registeredAt: device.createdAt,
  })), page, total, { policy: "REGISTERED_DEVICE", independentWhitelist: false });
}));

adminRouter.get("/devices", asyncRoute(async (req, res) => {
  const query = queryParams(req, ["page", "pageSize", "q", "userId", "linked", "source", "sort", "order"]);
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
      user: { select: { id: true, name: true, email: true, isActive: true } },
      plants: { orderBy: { id: "asc" }, select: { id: true, name: true, healthStatus: true } },
    } }),
    tx.device.count({ where }),
  ]), transactionOptions);

  // Same four-device batches, MAC/virtual-UUID join and normalization as SensorOverview.
  const readDevice = async (device: typeof devices[number]) => {
    const demo = device.macAddress.startsWith("DEMO:");
    const inventory = {
      id: device.id, name: device.name, macAddress: device.macAddress,
      owner: { id: device.user.id, name: device.user.name, emailMasked: maskedEmail(device.user.email), isActive: device.user.isActive },
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

adminRouter.get("/admins", asyncRoute(async (req, res) => {
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

adminRouter.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Route not found.")));
adminRouter.use(adminErrorHandler);
