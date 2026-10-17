import express from "express";
import { rateLimit } from "express-rate-limit";
import { SignJWT } from "jose";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";
import { adminSessionFixture } from "./helpers/admin-session-fixture.mjs";

process.env.AUTH_PROVIDER = "supabase";
process.env.AUTH_JWT_SECRET = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM";
process.env.AUTH_JWT_ISSUER = "admin-test";
process.env.AUTH_JWT_AUDIENCE = "admin-test";
process.env.AUTH_ALLOWED_ORIGINS = "https://example.test";

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const actorId = id(1), targetId = id(2), sessionId = randomUUID();
const now = new Date("2026-10-12T09:00:00.000Z");
const earlier = new Date(now.getTime() - 86_400_000);
const later = new Date(now.getTime() + 86_400_000);
let records, calls, failPg, failedReadings, readingConcurrency, maxReadingConcurrency, inTransaction;
let server, base, token;

const user = (userId, extra = {}) => ({ id: userId, email: "operator@example.test", name: "Operator",
  role: "USER", isActive: true, password: "SECRET_PASSWORD", createdAt: earlier, updatedAt: now, ...extra });
const device = (deviceId, macAddress, extra = {}) => ({ id: deviceId, macAddress, name: macAddress,
  userId: targetId, status: "OFFLINE", createdAt: earlier, updatedAt: now, ...extra });
const plant = (plantId, extra = {}) => ({ id: plantId, name: "Fern", species: "Example species", location: null,
  userId: targetId, deviceId: null, healthStatus: "warning", imageUrl: "PRIVATE_IMAGE", lastScannedAt: null, updatedAt: now, ...extra });
const reading = (deviceId, extra = {}) => ({ id: randomUUID(), deviceId, timestamp: now, temperature: 0,
  humidity: 0, soilMoisture: 2652, soilMoistureRaw: null, lightLux: 500, lightLevel: null, ...extra });

// Prisma-shaped read double: apply filters, ordering, projection, relation counts and caps.
function relation(model, row, key) {
  const many = (relatedModel, foreignKey, value = row.id) => ({ model: relatedModel,
    rows: records[relatedModel].filter(item => item[foreignKey] === value), many: true });
  const one = (relatedModel, foreignKey) => ({ model: relatedModel,
    rows: records[relatedModel].filter(item => item.id === row[foreignKey]), many: false });
  if (model === "user") {
    const relations = { plants: "plant", devices: "device", careTasks: "careTask", sessions: "authSession" };
    if (relations[key]) return many(relations[key], "userId");
  }
  if (model === "device" && key === "plants") return many("plant", "deviceId");
  if (model === "auditLog" && key === "actor") return one("user", "actorId");
  if (key === "user") return one("user", "userId");
  if (key === "plant") return one("plant", "plantId");
  return null;
}

function scalarMatches(value, condition) {
  if (condition === null || typeof condition !== "object" || condition instanceof Date) return value === condition;
  if ("in" in condition && !condition.in.includes(value)) return false;
  if ("not" in condition && scalarMatches(value, condition.not)) return false;
  if ("gt" in condition && !(value > condition.gt)) return false;
  if ("gte" in condition && !(value >= condition.gte)) return false;
  if ("lt" in condition && !(value < condition.lt)) return false;
  if ("lte" in condition && !(value <= condition.lte)) return false;
  if ("contains" in condition) {
    const text = condition.mode === "insensitive" ? value?.toLowerCase() : value;
    const literal = condition.contains.replace(/\\([\\%_])/g, "$1");
    const search = condition.mode === "insensitive" ? literal.toLowerCase() : literal;
    if (typeof text !== "string" || !text.includes(search)) return false;
  }
  if ("startsWith" in condition && !value?.startsWith(condition.startsWith)) return false;
  return true;
}

function matches(model, row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === "OR") return condition.some(item => matches(model, row, item));
    if (key === "NOT") return !matches(model, row, condition);
    const linked = relation(model, row, key);
    if (!linked) return scalarMatches(row[key], condition);
    if (!linked.many) return linked.rows.some(item => matches(linked.model, item, condition));
    if ("some" in condition && !linked.rows.some(item => matches(linked.model, item, condition.some))) return false;
    if ("none" in condition && linked.rows.some(item => matches(linked.model, item, condition.none))) return false;
    return true;
  });
}

function selectRows(model, rows, query) {
  const orders = Array.isArray(query.orderBy) ? query.orderBy : query.orderBy ? [query.orderBy] : [];
  const sorted = [...rows].sort((a, b) => {
    for (const order of orders) {
      const [key, direction] = Object.entries(order)[0];
      const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
      if (comparison) return direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
  return sorted.slice(query.skip ?? 0, query.take === undefined ? undefined : (query.skip ?? 0) + query.take)
    .map(row => project(model, row, query.select));
}

function project(model, row, select) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.entries(select).map(([key, selection]) => {
    if (key === "_count") return [key, Object.fromEntries(Object.entries(selection.select).map(([name, count]) => {
      const linked = relation(model, row, name);
      return [name, linked.rows.filter(item => matches(linked.model, item, count === true ? {} : count.where)).length];
    }))];
    const linked = relation(model, row, key);
    if (!linked) return [key, row[key]];
    const rows = selectRows(linked.model, linked.rows.filter(item => matches(linked.model, item, selection.where)), selection);
    return [key, linked.many ? rows : rows[0] ?? null];
  }));
}

const db = {};
for (const model of ["user", "plant", "device", "careTask", "aIAnalysis", "authSession", "adminSessionVerification", "auditLog"]) {
  db[model] = {};
  for (const method of ["findMany", "findUnique", "count"]) {
    db[model][method] = async query => {
      calls.push({ model, method, query, inTransaction });
      if (failPg === true || (failPg === "inventory" && inTransaction)) throw new Error("postgresql://PRIVATE_DB credentials");
      let rows = records[model].filter(row => matches(model, row, query.where));
      if (method === "count") return rows.length;
      rows = selectRows(model, rows, query);
      if (method === "findUnique") {
        const row = rows[0] ?? null;
        return row && query.include?.user ? { ...row, user: records.user.find(user => user.id === row.userId) } : row;
      }
      return rows;
    };
  }
}
db.$transaction = async (callback, options) => {
  calls.push({ model: "transaction", options });
  inTransaction = true;
  try { return await callback(db); } finally { inTransaction = false; }
};

before(async () => {
  mock.module(new URL("../src/lib/supabase-session.js", import.meta.url).href, { namedExports:
    adminSessionFixture(id => db.authSession.findUnique({ where: { id }, include: { user: true } })) });
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: db } });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: { sensorReading: {
    findFirst: async query => {
      calls.push({ model: "sensorReading", query });
      maxReadingConcurrency = Math.max(maxReadingConcurrency, ++readingConcurrency);
      try {
        await new Promise(resolve => setImmediate(resolve));
        if (failedReadings.has(query.where.deviceId)) throw new Error("mongodb://PRIVATE_DB credentials");
        return selectRows("sensorReading", records.sensorReading.filter(row => matches("sensorReading", row, query.where)), query)[0] ?? null;
      } finally { readingConcurrency--; }
    },
    groupBy: async query => {
      calls.push({ model: "sensorReading", method: "groupBy", query });
      if (query.where.deviceId.in.some(key => failedReadings.has(key))) throw new Error("mongodb://PRIVATE_DB credentials");
      const groups = new Map();
      for (const row of records.sensorReading.filter(row => matches("sensorReading", row, query.where))) {
        const previous = groups.get(row.deviceId);
        if (!previous || row.timestamp > previous) groups.set(row.deviceId, row.timestamp);
      }
      return [...groups].map(([deviceId, timestamp]) => ({ deviceId, _max: { timestamp } }));
    },
  } } } });
  const { adminRouter, adminErrorHandler, adminResponseHeaders } = await import("../src/routes/admin.ts");
  const { accessToken } = await import("../src/lib/auth.ts");
  // Date mocking makes freshness boundaries and the asOf session counts deterministic.
  mock.timers.enable({ apis: ["Date"], now: now.getTime() });
  token = await accessToken(actorId, sessionId);
  const app = express();
  app.use(["/api/admin", "/limited"], adminResponseHeaders);
  app.use("/limited", rateLimit({ windowMs: 900_000, limit: 1, message: (_req, res) => ({
    error: "Too many requests. Please try again later.", code: "RATE_LIMITED", requestId: res.locals.admin.requestId,
  }) }));
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/admin", adminRouter);
  app.use("/limited", (_req, res) => res.json({ ok: true }));
  app.use(adminErrorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  records = { user: [user(actorId, { role: "ADMIN" })], plant: [], device: [], careTask: [], aIAnalysis: [], sensorReading: [], auditLog: [],
    adminSessionVerification: [{ id: randomUUID(), userId: actorId, supabaseSessionId: sessionId, verifiedAt: earlier, expiresAt: later, authVersion: 0 }],
    authSession: [{ id: sessionId, userId: actorId, client: "native", createdAt: now, expiresAt: later, revokedAt: null, tokenHash: "SECRET_TOKEN_HASH" }] };
  calls = []; failPg = false; failedReadings = new Set(); readingConcurrency = 0; maxReadingConcurrency = 0; inTransaction = false;
});
after(async () => { await new Promise(resolve => server.close(resolve)); mock.restoreAll(); });

async function get(path, access = token, options = {}) {
  const response = await fetch(base + "/api/admin" + path, { ...options,
    headers: { ...(access ? { Authorization: `Bearer ${access}` } : {}), ...options.headers } });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
function checkError(result, status, code) {
  assert.equal(result.status, status);
  assert.equal(result.body.code, code);
  assert.equal(typeof result.body.error, "string");
  assert.deepEqual(Object.keys(result.body).sort(), ["code", "error", "requestId"]);
  assert.match(result.body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(result.headers.get("x-request-id"), result.body.requestId);
  assert.equal(result.headers.get("cache-control"), "no-store");
}
function checkPrivacy(body) {
  const serialized = JSON.stringify(body);
  for (const secret of ["password", "tokenHash", "sessionId", sessionId, "rawResponse", "rawAnalysisText", "telemetrySnapshot", "PRIVATE_", "SECRET_"]) {
    assert.ok(!serialized.includes(secret), `Response leaked ${secret}`);
  }
}
function checkTransactions() {
  assert.ok(calls.some(call => call.model === "transaction"));
  assert.ok(calls.filter(call => call.model === "transaction").every(call => call.options.isolationLevel === "RepeatableRead"));
  assert.ok(calls.filter(call => call.model !== "transaction" && call.model !== "sensorReading"
    && !(["authSession", "adminSessionVerification"].includes(call.model) && call.method === "findUnique")).every(call => call.inTransaction));
}
const paths = ["/users", `/users/${targetId}`, "/devices", "/devices/whitelist", "/admins", "/audit", "/stats"];

test("admin endpoints require current roles; LEAD_DEV is restricted to operational devices", async () => {
  records.user.push(user(targetId));
  for (const path of paths) checkError(await get(path, null), 401, "INVALID_SESSION");
  assert.equal(calls.length, 0);
  records.user[0].role = "USER";
  const forgedRoleToken = await new SignJWT({ sid: sessionId, role: "ADMIN" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(actorId)
    .setIssuer("admin-test").setAudience("admin-test").setIssuedAt().setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET));
  for (const path of paths) checkError(await get(path, forgedRoleToken), 403, "ADMIN_REQUIRED");
  assert.ok(calls.every(call => call.model === "authSession"));
  for (const role of ["ADMIN", "LEAD_DEV"]) {
    records.user[0].role = role;
    for (const path of paths) {
      const result = await get(path);
      if (role === "LEAD_DEV" && path !== "/devices" && path !== "/stats") {
        checkError(result, 403, "FORBIDDEN");
        continue;
      }
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal(result.body.meta.schemaVersion, 1);
      checkPrivacy(result.body);
    }
  }
  records.user[0].role = "USER";
  checkError(await get("/users"), 403, "ADMIN_REQUIRED");
});

test("inactive, revoked, expired and invalid sessions are 401 with request IDs", async () => {
  records.user[0].isActive = false;
  checkError(await get("/users"), 401, "INVALID_SESSION");
  records.user[0].isActive = true;
  records.authSession[0].revokedAt = now;
  checkError(await get("/users"), 401, "INVALID_SESSION");
  records.authSession[0].revokedAt = null; records.authSession[0].expiresAt = now;
  checkError(await get("/users"), 401, "INVALID_SESSION");
  checkError(await get("/users", "invalid.token"), 401, "INVALID_SESSION");
});

test("users mask emails, return filtered counts and paginate/search with stable ordering", async () => {
  records.user.push(user(targetId, { name: null, email: "alpha@example.test" }),
    user(id(3), { name: "Alpha Two", email: "second@example.test" }), user(id(4), { isActive: false }));
  records.plant.push(plant(id(10)), plant(id(11)));
  records.device.push(device(id(20), "LC-A50528"));
  records.careTask.push({ userId: targetId, status: "PENDING" }, { userId: targetId, status: "COMPLETED" });
  const first = await get("/users?q=%20ALPHA%20&role=USER&isActive=true&pageSize=1&sort=createdAt&order=asc");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.pagination, { page: 1, pageSize: 1, total: 2, totalPages: 2 });
  assert.deepEqual(first.body.data, [{ id: targetId, name: null, emailMasked: "a***@example.test", role: "USER", isActive: true,
    createdAt: earlier.toISOString(), updatedAt: now.toISOString(), counts: { plants: 2, devices: 1, pendingCareTasks: 1 } }]);
  const second = await get("/users?q=ALPHA&role=USER&isActive=true&pageSize=1&page=2&sort=createdAt&order=asc");
  assert.equal(second.body.data[0].id, id(3));
  assert.equal(second.body.data[0].email, undefined);
  assert.deepEqual((await get("/users")).body.pagination, { page: 1, pageSize: 25, total: 4, totalPages: 1 });
  checkPrivacy(first.body); checkTransactions();
});

test("full emails require an explicit SuperAdmin reveal request and never change the masked default", async () => {
  records.user.push(user(targetId, { email: "private@example.test" }));
  const revealed = await get("/users?revealEmails=true");
  assert.equal(revealed.status, 200);
  assert.equal(revealed.body.data.find(row => row.id === targetId).email, "private@example.test");
  assert.equal(revealed.headers.get("cache-control"), "no-store");
  assert.ok((await get("/users?revealEmails=false")).body.data.every(row => !("email" in row)));
  assert.ok((await get("/users")).body.data.every(row => !("email" in row)));
  checkError(await get("/users?revealEmails=yes"), 400, "INVALID_INPUT");
  records.user[0].role = "LEAD_DEV";
  checkError(await get("/users?revealEmails=true"), 403, "FORBIDDEN");
});

test("stats count domain records and only registered physical devices with a fresh latest sample", async () => {
  records.user.push(user(targetId, { isActive: false }));
  records.plant.push(plant(id(10)), plant(id(11)));
  records.aIAnalysis.push({ id: id(20), plantId: id(10) }, { id: id(21), plantId: id(11) });
  const offsets = [0, -1800_000, -1800_001, 60_000, 60_001, null];
  for (const [index, offset] of offsets.entries()) {
    const item = device(id(100 + index), `LC-${String(index).padStart(6, "0")}`);
    records.device.push(item);
    if (offset !== null) records.sensorReading.push(reading(item.macAddress, { timestamp: new Date(now.getTime() + offset) }));
  }
  records.device.push(device(id(200), `DEMO:${id(201)}`));
  records.sensorReading.push(reading(id(200)), reading("UNREGISTERED"),
    reading(records.device[4].macAddress, { timestamp: now }));
  const result = await get("/stats");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { totalUsers: 2, totalPlants: 2, totalAiScans: 2, totalActiveDevices: 3 });
  assert.equal(result.body.meta.telemetryDegraded, false);
  assert.equal(result.body.meta.freshnessWindowSeconds, 1800);
  assert.equal(result.body.meta.asOf, now.toISOString());
  assert.equal(calls.filter(call => call.method === "groupBy").length, 1);
  checkPrivacy(result.body); checkTransactions();
  records.user[0].role = "LEAD_DEV";
  assert.deepEqual((await get("/stats")).body.data, result.body.data);
  checkError(await get("/stats?role=ADMIN"), 400, "INVALID_INPUT");
});

test("stats return unknown connectivity on telemetry failure, truthful zero when empty, and bound batch sizes", async () => {
  assert.equal((await get("/stats")).body.data.totalActiveDevices, 0);
  assert.equal(calls.some(call => call.model === "sensorReading"), false);
  for (let index = 0; index < 501; index++) records.device.push(device(id(1000 + index), `LC-${String(index).padStart(6, "0")}`));
  calls = [];
  const available = await get("/stats");
  assert.equal(available.body.data.totalActiveDevices, 0);
  assert.deepEqual(calls.filter(call => call.method === "groupBy").map(call => call.query.where.deviceId.in.length), [500, 1]);
  failedReadings.add(records.device[0].macAddress);
  const unavailable = await get("/stats");
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.body.data.totalActiveDevices, null);
  assert.equal(unavailable.body.meta.telemetryDegraded, true);
  assert.equal(unavailable.body.data.totalUsers, 1);
  assert.ok(!JSON.stringify(unavailable.body).includes("PRIVATE_DB"));
});

test("audit lists resolve actor and target emails in a bounded batch and retain deleted IDs", async () => {
  records.user.push(user(targetId, { email: "target@example.test" }));
  records.auditLog.push(
    { id: id(10), actorId, targetId, action: "USER_UPDATED", metadata: {}, ipAddress: null, createdAt: now },
    { id: id(11), actorId: null, targetId: id(999), action: "USER_DELETED", metadata: { actorId: id(888) }, ipAddress: null, createdAt: earlier },
  );
  const result = await get("/audit?pageSize=5");
  assert.equal(result.status, 200);
  assert.equal(result.body.pagination.total, 2);
  assert.equal(result.body.data[0].actorEmail, "operator@example.test");
  assert.equal(result.body.data[0].targetEmail, "target@example.test");
  assert.equal(result.body.data[0].actorId, actorId);
  assert.equal(result.body.data[1].actorEmail, null);
  assert.equal(result.body.data[1].targetEmail, null);
  assert.equal(result.body.data[1].targetId, id(999));
  assert.equal(result.body.data[1].metadata.actorId, id(888));
  assert.equal(calls.filter(call => call.model === "user" && call.method === "findMany").length, 1);
  checkPrivacy(result.body); checkTransactions();
});

test("empty and out-of-range pages stay 200 with truthful pagination", async () => {
  for (const path of ["/users?q=absent", "/devices", "/devices/whitelist", "/admins?q=absent"]) {
    const result = await get(path);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, []);
    assert.deepEqual(result.body.pagination, { page: 1, pageSize: 25, total: 0, totalPages: 0 });
  }
  const outOfRange = await get("/users?page=2");
  assert.deepEqual(outOfRange.body.data, []);
  assert.deepEqual(outOfRange.body.pagination, { page: 2, pageSize: 25, total: 1, totalPages: 1 });
});

test("strict query validation rejects unknown/repeated parameters, bad UUIDs/enums and unsafe pagination", async () => {
  for (const query of ["page=0", "page=-1", "page=1.5", "page=1x", "page=", "page=1e2", "pageSize=101", "pageSize=0",
    "page=9007199254740992", "page=2147483649", "page=1&page=2", "q=a&q=b", "q[]=a", "offset=1", "role=ROOT",
    "isActive=1", "sort=password", "order=down", `q=${"a".repeat(101)}`]) {
    checkError(await get(`/users?${query}`), 400, "INVALID_INPUT");
  }
  for (const path of ["/devices?userId=bad", "/devices?linked=1", "/devices?source=VIRTUAL", "/devices?online=true",
    "/devices/whitelist?source=PHYSICAL", "/devices/whitelist?userId=bad", "/admins?role=USER", "/admins?sort=name",
    `/users/${targetId}?page=1`, "/users/bad-id"]) checkError(await get(path), 400, "INVALID_INPUT");
  assert.equal(calls.some(call => call.model === "transaction"), false);
  assert.equal((await get("/users?q=operator?example")).body.pagination.total, 0);
  assert.equal((await get("/users?q=%20%20")).body.pagination.total, 1);
  records.user.push(user(targetId, { name: "50%_\\ complete" }));
  assert.equal((await get("/users?q=%25_%5C")).body.pagination.total, 1);
  const searchQuery = calls.findLast(call => call.model === "user" && call.method === "findMany").query;
  assert.equal(searchQuery.where.OR[1].name.contains, "\\%\\_\\\\");
});

test("user detail caps related lists, includes legacy analyses and disjoint session/task counts", async () => {
  records.user.push(user(targetId, { email: "detail@example.test", name: null }));
  for (let index = 0; index < 12; index++) {
    records.plant.push(plant(id(100 + index), { imageUrl: index === 0 ? null : "PRIVATE_IMAGE" }));
    records.device.push(device(id(200 + index), index === 0 ? `DEMO:${id(100)}` : `LC-${String(index).padStart(6, "0")}`));
    const snapshot = index === 0 ? null : index === 5 ? {source: "none"} : { deviceId: index === 4 ? id(777) : "LC-A50528", timestamp: earlier.toISOString(),
      capturedAt: index === 2 ? now.toISOString() : earlier.toISOString(), temperature: 27, humidity: 60,
      ...(index === 3 ? { simulated: true } : {}) };
    records.aIAnalysis.push({ id: id(300 + index), plantId: id(100 + index), userId: null, healthStatus: "warning",
      rawAnalysisText: index === 0 ? "  " : "PRIVATE_REPORT", telemetrySnapshot: snapshot, rawResponse: "PRIVATE_PROVIDER", createdAt: now });
    records.careTask.push({ id: id(400 + index), userId: targetId, plantId: id(100 + index), title: "Check soil", urgency: "routine",
      status: ["PENDING", "COMPLETED", "SKIPPED"][index % 3], dueDate: new Date(now.getTime() + index * 1000), completedAt: null });
  }
  // A foreign analysis must remain excluded even if its legacy userId happens to match.
  records.plant.push(plant(id(900), { userId: actorId }));
  records.aIAnalysis.push({ id: id(901), plantId: id(900), userId: targetId, createdAt: later });
  records.authSession.push(
    { id: randomUUID(), userId: targetId, expiresAt: later, revokedAt: null },
    { id: randomUUID(), userId: targetId, expiresAt: earlier, revokedAt: earlier },
    { id: randomUUID(), userId: targetId, expiresAt: now, revokedAt: null });
  const result = await get(`/users/${targetId}`);
  assert.equal(result.status, 200);
  const detail = result.body.data;
  assert.equal(detail.user.email, "detail@example.test");
  assert.deepEqual(detail.counts, { plants: 12, devices: 12, analyses: 12,
    careTasks: { pending: 4, completed: 4, skipped: 4 }, sessions: { active: 1, revoked: 1, expired: 1 } });
  for (const collection of ["plants", "devices", "analyses", "careTasks"]) {
    assert.equal(detail[collection].items.length, 10); assert.equal(detail[collection].total, 12); assert.equal(detail[collection].truncated, true);
  }
  assert.equal(detail.plants.items[0].imageAvailable, false);
  assert.equal(detail.plants.items[1].imageAvailable, true);
  assert.equal(detail.devices.items[0].storedStatus, "OFFLINE");
  assert.equal(detail.devices.items[0].source, "DEMO");
  assert.deepEqual(detail.analyses.items.slice(0, 5).map(item => item.telemetrySource),
    ["IMAGE_ONLY", "PHYSICAL_FRESH", "PHYSICAL_STALE", "DEMO", "IMAGE_ONLY"]);
  assert.equal(detail.analyses.items[0].diagnosisError, true);
  assert.equal(detail.analyses.items[1].diagnosisError, false);
  assert.equal(detail.analyses.items[1].telemetryTimestamp, earlier.toISOString());
  assert.equal(detail.analyses.items[5].telemetrySource, "IMAGE_ONLY");
  assert.equal(detail.analyses.items[5].telemetryTimestamp, null);
  checkPrivacy(result.body); checkTransactions();
  checkError(await get(`/users/${id(999)}`), 404, "NOT_FOUND");
});

test("user detail returns explicit empty collections and zero counts", async () => {
  records.user.push(user(targetId));
  const detail = (await get(`/users/${targetId}`)).body.data;
  for (const collection of ["plants", "devices", "analyses", "careTasks"]) {
    assert.deepEqual(detail[collection], { items: [], total: 0, truncated: false });
  }
  assert.deepEqual(detail.counts, { plants: 0, devices: 0, analyses: 0, careTasks: { pending: 0, completed: 0, skipped: 0 },
    sessions: { active: 0, revoked: 0, expired: 0 } });
});

test("devices include all owners, multi-plant/unlinked inventory and latest normalized MAC/demo UUID samples", async () => {
  records.user.push(user(targetId, { name: null, isActive: false }));
  const physical = device(id(10), "LC-A50528"), demo = device(id(11), `DEMO:${id(20)}`), unlinked = device(id(12), "LC-000012");
  records.device.push(physical, demo, unlinked);
  records.plant.push(plant(id(20), { deviceId: physical.id }), plant(id(21), { deviceId: physical.id, name: "Palm" }));
  records.sensorReading.push(reading(physical.id, { temperature: 99 }), reading(physical.macAddress, { timestamp: earlier, temperature: 99 }),
    reading(physical.macAddress), reading(demo.id, { soilMoisture: 50, soilMoistureRaw: 1234, lightLevel: 900 }));
  const result = await get("/devices");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.meta, { schemaVersion: 1, asOf: now.toISOString(), freshnessWindowSeconds: 1800, futureToleranceSeconds: 60, telemetryDegraded: false });
  const row = result.body.data.find(item => item.id === physical.id);
  assert.deepEqual(row.owner, { id: targetId, name: null, email: "operator@example.test", emailMasked: "o***@example.test", isActive: false });
  assert.equal(row.plants.length, 2);
  assert.equal(row.storedStatus, "OFFLINE"); assert.equal(row.connectionStatus, "ONLINE");
  assert.equal(row.lastReadingAt, now.toISOString()); assert.equal(row.readingAgeSeconds, 0);
  assert.deepEqual(row.telemetry, { temperatureCelsius: 0, humidityPercentage: 0, soilMoisturePercentage: null, soilMoistureRaw: 2652, lightLux: 500 });
  const simulated = result.body.data.find(item => item.id === demo.id);
  assert.equal(simulated.source, "DEMO"); assert.equal(simulated.connectionStatus, "SIMULATED");
  assert.equal(simulated.telemetry.soilMoisturePercentage, 50); assert.equal(simulated.telemetry.lightLux, 900);
  const missing = result.body.data.find(item => item.id === unlinked.id);
  assert.equal(missing.connectionStatus, "NO_READINGS"); assert.equal(missing.telemetry, null); assert.equal(missing.readingAgeSeconds, null);
  assert.deepEqual(missing.plants, []);
  assert.deepEqual(calls.filter(call => call.model === "sensorReading").map(call => call.query.where.deviceId).sort(),
    [physical.macAddress, demo.id, unlinked.macAddress].sort());
  checkPrivacy(result.body); checkTransactions();
  const linked = await get(`/devices?linked=true&source=PHYSICAL&userId=${targetId}&q=palm&pageSize=1`);
  assert.deepEqual(linked.body.data.map(item => item.id), [physical.id]);
  assert.equal(linked.body.pagination.total, 1);
  assert.equal((await get("/devices?linked=false&source=DEMO")).body.data[0].id, demo.id);
});

test("device freshness handles stale, future, missing and partial failures with four-read concurrency", async () => {
  records.user.push(user(targetId));
  const offsets = [0, -1800_000, -1800_001, 60_000, 60_001, null, 0, 0, null, 0, 0];
  for (let index = 0; index < offsets.length; index++) {
    const demo = index >= 7;
    const item = device(id(100 + index), demo ? `DEMO:${id(200 + index)}` : `LC-${String(index).padStart(6, "0")}`,
      { name: String(index).padStart(2, "0") });
    records.device.push(item);
    const key = demo ? item.id : item.macAddress;
    if (offsets[index] !== null) records.sensorReading.push(reading(key, { timestamp: new Date(now.getTime() + offsets[index]) }));
    if (index === 6 || index === 7) failedReadings.add(key);
    if (index === 10) records.sensorReading.at(-1).timestamp = new Date(NaN);
  }
  const result = await get("/devices");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.map(item => item.connectionStatus),
    ["ONLINE", "ONLINE", "OFFLINE", "ONLINE", "UNKNOWN", "NO_READINGS", "UNKNOWN", "UNKNOWN", "SIMULATED", "SIMULATED", "UNKNOWN"]);
  assert.equal(result.body.data[3].readingAgeSeconds, -60);
  assert.equal(result.body.data[4].readingAgeSeconds, -61);
  assert.equal(result.body.data[6].readingError, true); assert.equal(result.body.data[7].source, "DEMO");
  assert.equal(result.body.meta.telemetryDegraded, true);
  assert.equal(maxReadingConcurrency, 4);
  checkPrivacy(result.body);
  calls = [];
  const page = await get("/devices?page=2&pageSize=2");
  assert.deepEqual(page.body.pagination, { page: 2, pageSize: 2, total: offsets.length, totalPages: 6 });
  assert.equal(calls.filter(call => call.model === "sensorReading").length, 2);
});

test("whitelist reports registered-MAC policy, excludes demo and validates legacy identifiers", async () => {
  records.user.push(user(targetId, { isActive: false }));
  for (const [index, macAddress] of ["LC-A50528", "AA:BB:CC:DD:EE:FF", "AA-BB-CC-DD-EE-00", "invalid-legacy", `DEMO:${id(10)}`].entries()) {
    records.device.push(device(id(100 + index), macAddress));
  }
  const result = await get("/devices/whitelist");
  assert.equal(result.status, 200); assert.equal(result.body.pagination.total, 4);
  assert.equal(result.body.meta.policy, "REGISTERED_DEVICE"); assert.equal(result.body.meta.independentWhitelist, false);
  for (const item of result.body.data) {
    assert.equal(item.ownerIsActive, false); assert.equal(item.proofOfPossessionVerified, false);
    assert.equal(item.authorizationBasis, "REGISTERED_DEVICE");
    assert.equal(item.ingestionAllowed, item.macAddress !== "invalid-legacy");
    assert.equal(item.ownerId, targetId); assert.equal(item.registeredAt, earlier.toISOString());
  }
  assert.equal(calls.some(call => call.model === "sensorReading"), false);
  const filtered = await get(`/devices/whitelist?userId=${targetId}&q=lc-&pageSize=1`);
  assert.equal(filtered.body.pagination.total, 1); assert.equal(filtered.body.data[0].macAddress, "LC-A50528");
  checkPrivacy(result.body); checkTransactions();
});

test("admins list restricts roles and counts only unrevoked, unexpired sessions", async () => {
  records.user.push(user(targetId, { role: "LEAD_DEV", isActive: false, name: null }), user(id(3)));
  records.authSession.push({ id: randomUUID(), userId: targetId, expiresAt: later, revokedAt: null },
    { id: randomUUID(), userId: targetId, expiresAt: now, revokedAt: null },
    { id: randomUUID(), userId: targetId, expiresAt: later, revokedAt: now });
  const result = await get("/admins");
  assert.deepEqual(result.body.data.map(item => item.role), ["ADMIN", "LEAD_DEV"]);
  assert.deepEqual(result.body.data.map(item => item.activeSessionCount), [1, 1]);
  assert.equal(result.body.data[1].isActive, false); assert.equal(result.body.data[1].emailMasked, "o***@example.test");
  const filtered = await get("/admins?role=LEAD_DEV&isActive=false&q=OPERATOR&pageSize=1");
  assert.equal(filtered.body.pagination.total, 1); assert.equal(filtered.body.data[0].id, targetId);
  checkPrivacy(result.body); checkTransactions();
});

test("PostgreSQL failures are sanitized 503 and deferred/write routes remain absent", async () => {
  for (const failure of [true, "inventory"]) {
    failPg = failure;
    for (const path of paths) {
      const result = await get(path); checkError(result, 503, "ADMIN_DATA_UNAVAILABLE"); checkPrivacy(result.body);
    }
  }
  failPg = false;
  for (const path of ["/api-monitor", "/audit-log", "/users/00000000-0000-4000-8000-000000000099/plants"]) {
    checkError(await get(path), 404, "NOT_FOUND");
  }
  checkError(await get("/admins", token, { method: "POST" }), 404, "NOT_FOUND");
});

test("admin parser, body rejection and global limiter errors carry no-store and request IDs", async () => {
  checkError(await get("/users", token, { headers: { "Content-Type": "application/json" },
    method: "POST", body: "{" }), 400, "INVALID_INPUT");
  // node fetch prohibits GET bodies; node:http exercises the actual read-route body check.
  const { request } = await import("node:http");
  const result = await new Promise((resolve, reject) => {
    const req = request(base + "/api/admin/users", { headers: { Authorization: `Bearer ${token}`,
      "Content-Type": "application/json", "Content-Length": "2" } }, res => {
      let body = ""; res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body), headers: new Headers(res.headers) }));
    });
    req.on("error", reject); req.end("{}");
  });
  checkError(result, 400, "INVALID_INPUT");
  await fetch(base + "/limited");
  const limited = await fetch(base + "/limited");
  checkError({ status: limited.status, body: await limited.json(), headers: limited.headers }, 429, "RATE_LIMITED");
});
