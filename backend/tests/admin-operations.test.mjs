import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { memoryModel } from "./helpers/security-store.mjs";

process.env.AUTH_PROVIDER = "supabase";
const ids = Object.fromEntries(["admin", "lead", "owner", "device", "plant", "pairing"].map(key => [key, randomUUID()]));
const stamp = new Date("2026-10-01T00:00:00.000Z");
const users = new Map(), devices = new Map(), plants = new Map(), pairings = new Map();
const sessions = new Map(), proofs = new Map(), challenges = new Map(), audits = new Map(), readings = new Map();
const db = {
  user: memoryModel(users), plant: memoryModel(plants), devicePairingHistory: memoryModel(pairings),
  authSession: memoryModel(sessions), adminSessionVerification: memoryModel(proofs),
  adminChallenge: memoryModel(challenges), auditLog: memoryModel(audits),
};
const deviceModel = memoryModel(devices);
db.device = {
  ...deviceModel,
  findUnique: async query => {
    const device = await deviceModel.findUnique({ where: query.where });
    if (!device) return null;
    if (!query.select?.pairingHistory) return device;
    return { ...device, user: users.get(device.userId),
      plants: [...plants.values()].filter(plant => plant.deviceId === device.id).map(({ id, name, healthStatus }) => ({ id, name, healthStatus })),
      pairingHistory: [...pairings.values()].filter(pairing => pairing.deviceId === device.id && pairing.unpairedAt === null)
        .map(pairing => ({ ...pairing, plant: { name: plants.get(pairing.plantId).name } })),
    };
  },
  updateMany: async query => {
    const candidate = devices.get(query.where.id);
    if (query.where.updatedAt && candidate?.updatedAt.getTime() !== query.where.updatedAt.getTime()) return { count: 0 };
    return deviceModel.updateMany({ ...query, where: { id: query.where.id } });
  },
};
const mongo = { sensorReading: memoryModel(readings) };
let failAudit = false, telemetryQueries = [], base, server;
const createAudit = db.auditLog.create;
db.auditLog.create = async query => { if (failAudit) throw new Error("audit unavailable"); return createAudit(query); };
const findReadings = mongo.sensorReading.findMany;
mongo.sensorReading.findMany = async query => { telemetryQueries.push(query); return findReadings(query); };
db.$transaction = async (callback, options) => {
  assert.equal(options.isolationLevel, "Serializable");
  const tables = [users, devices, plants, pairings, sessions, proofs, challenges, audits];
  const snapshots = tables.map(table => structuredClone([...table]));
  try { return await callback(db); }
  catch (error) {
    tables.forEach((table, index) => { table.clear(); for (const [key, value] of snapshots[index]) table.set(key, value); });
    throw error;
  }
};

before(async () => {
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: db } });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: mongo } });
  const { requireAdminVerification } = await import("../src/lib/admin-verification.ts");
  const { adminOperationsRouter } = await import("../src/routes/admin-operations.ts");
  const { errorHandler } = await import("../src/lib/http.ts");
  const app = express(); app.use(express.json());
  // Authentication itself is covered by auth.test and supabase-auth.test. Here
  // a live application row supplies the same context for route/OTP/RBAC checks.
  app.use((req, res, next) => {
    const user = users.get(req.get("authorization")?.slice(7));
    if (!user) { res.status(401).json({ code: "INVALID_SESSION" }); return; }
    res.locals.auth = { user, sessionId: `session-${user.id}` }; next();
  });
  app.use("/api/admin", requireAdminVerification, adminOperationsRouter); app.use(errorHandler);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/admin`;
});
beforeEach(() => {
  for (const table of [users, devices, plants, pairings, sessions, proofs, challenges, audits, readings]) table.clear();
  failAudit = false; telemetryQueries = [];
  for (const [key, role] of [["admin", "ADMIN"], ["lead", "LEAD_DEV"], ["owner", "USER"]]) {
    users.set(ids[key], { id: ids[key], role, email: `${key}@example.test`, name: key, isActive: true,
      authVersion: 0, authInvalidBefore: null, updatedAt: stamp });
    if (role !== "USER") proofs.set(key, { id: key, userId: ids[key], supabaseSessionId: `session-${ids[key]}`,
      authVersion: 0, verifiedAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000) });
  }
  devices.set(ids.device, { id: ids.device, name: "Sensor", macAddress: "LC-A50528", userId: ids.owner,
    status: "OFFLINE", createdAt: stamp, updatedAt: stamp });
  plants.set(ids.plant, { id: ids.plant, name: "Fern", healthStatus: "healthy", userId: ids.owner, deviceId: ids.device });
  pairings.set(ids.pairing, { id: ids.pairing, deviceId: ids.device, plantId: ids.plant, pairedAt: stamp, unpairedAt: null });
});
after(async () => { await new Promise(resolve => server.close(resolve)); mock.restoreAll(); });
async function request(path, { role = "lead", method = "GET", body } = {}) {
  const response = await fetch(base + path, { method,
    headers: { authorization: `Bearer ${ids[role]}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
const rename = extra => ({ name: "Living room", updatedAt: stamp.toISOString(), reason: "Correct room label", ...extra });
const unlink = extra => ({ updatedAt: stamp.toISOString(), expectedPairingId: ids.pairing, reason: "Relocating sensor", ...extra });

test("device details redact owner data on operator reads and expose the expected current pairing", async () => {
  const lead = await request(`/devices/${ids.device}`);
  assert.equal(lead.status, 200); assert.equal(lead.body.data.pairing.id, ids.pairing);
  assert.equal(lead.body.data.pairing.plantName, "Fern");
  assert.ok(!JSON.stringify(lead.body).includes("owner@example.test"));
  assert.ok(!JSON.stringify(lead.body).includes(ids.owner));
  const admin = await request(`/devices/${ids.device}`, { role: "admin" });
  assert.equal(admin.body.data.owner.email, "owner@example.test");
  assert.equal((await request(`/devices/${ids.device}`, { role: "owner" })).status, 403);
});

test("operator reads bypass OTP while writes require a current proof", async () => {
  proofs.delete("lead");
  assert.equal((await request(`/devices/${ids.device}`)).status, 200);
  const denied = await request(`/devices/${ids.device}`, { method: "PATCH", body: rename() });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, "ADMIN_VERIFICATION_REQUIRED");
  assert.equal(devices.get(ids.device).name, "Sensor"); assert.equal(audits.size, 0);
});

test("verified LEAD_DEV can rename with concurrency checks and a transactional audit", async () => {
  const result = await request(`/devices/${ids.device}`, { method: "PATCH", body: rename() });
  assert.equal(result.status, 200); assert.equal(result.body.data.name, "Living room");
  assert.equal("owner" in result.body.data, false);
  assert.notEqual(result.body.data.updatedAt, stamp.toISOString());
  const audit = [...audits.values()][0];
  assert.equal(audit.action, "DEVICE_RENAMED"); assert.equal(audit.actorId, ids.lead);
  assert.equal(audit.targetId, ids.device); assert.equal(audit.metadata.reason, "Correct room label");
  assert.deepEqual(audit.metadata.before, { name: "Sensor" });
  const stale = await request(`/devices/${ids.device}`, { method: "PATCH", body: rename({ name: "Stale" }) });
  assert.equal(stale.status, 409); assert.equal(devices.get(ids.device).name, "Living room");
});

test("device mutation input rejects identity changes, missing versions and empty reasons", async () => {
  for (const body of [rename({ userId: ids.admin }), rename({ macAddress: "LC-000000" }), rename({ updatedAt: undefined }), rename({ reason: " " }), rename({ name: "x\u0000" })]) {
    assert.equal((await request(`/devices/${ids.device}`, { method: "PATCH", body })).status, 400);
  }
  assert.equal(audits.size, 0);
});

test("unlink requires the same pairing and preserves closed history, telemetry and report associations", async () => {
  readings.set("retained", { id: "retained", deviceId: "LC-A50528", plantId: ids.plant, pairingId: ids.pairing,
    timestamp: stamp, temperature: 26, humidity: 62 });
  const rejected = await request(`/devices/${ids.device}/unlink`, { method: "POST", body: unlink({ expectedPairingId: randomUUID() }) });
  assert.equal(rejected.status, 409); assert.equal(plants.get(ids.plant).deviceId, ids.device);
  const result = await request(`/devices/${ids.device}/unlink`, { method: "POST", body: unlink() });
  assert.equal(result.status, 200); assert.equal(result.body.data.pairing, null);
  assert.equal(plants.get(ids.plant).deviceId, null); assert.equal(pairings.size, 1);
  assert.ok(pairings.get(ids.pairing).unpairedAt >= stamp);
  assert.equal(readings.get("retained").pairingId, ids.pairing);
  assert.equal([...audits.values()][0].action, "DEVICE_UNLINKED");
});

test("an audit failure rolls back renaming and unlinking", async () => {
  failAudit = true;
  assert.equal((await request(`/devices/${ids.device}`, { method: "PATCH", body: rename() })).status, 500);
  assert.equal(devices.get(ids.device).name, "Sensor");
  assert.equal((await request(`/devices/${ids.device}/unlink`, { method: "POST", body: unlink() })).status, 500);
  assert.equal(plants.get(ids.plant).deviceId, ids.device); assert.equal(pairings.get(ids.pairing).unpairedAt, null);
});

test("diagnostics return only five latest stored readings with raw ADC, zeroes and unavailable fields", async () => {
  for (let index = 0; index < 8; index++) readings.set(String(index), { id: String(index), deviceId: "LC-A50528",
    timestamp: new Date(stamp.getTime() + index * 1000), temperature: 0, humidity: 0,
    soilMoisture: 2180 + index, soilMoistureRaw: null, lightLevel: null, lightLux: null });
  const result = await request(`/devices/${ids.device}/readings?limit=5`);
  assert.equal(result.status, 200); assert.equal(result.body.data.length, 5);
  assert.equal(result.body.data[0].id, "7"); assert.equal(result.body.data[0].soilMoistureRaw, 2187);
  assert.equal(result.body.data[0].temperatureCelsius, 0); assert.equal(result.body.data[0].humidityPercentage, 0);
  assert.equal(result.body.data[0].lightLux, null); assert.equal(result.body.data[0].simulated, false);
  assert.equal(telemetryQueries[0].take, 5); assert.equal(telemetryQueries[0].where.deviceId, "LC-A50528");
  for (const suffix of ["?limit=6", "?limit=0", "?limit=1&limit=2", "?userId=private"]) {
    assert.equal((await request(`/devices/${ids.device}/readings${suffix}`)).status, 400);
  }
});

test("demo diagnostics identify simulated readings and do not invent a raw ADC from a percentage", async () => {
  devices.get(ids.device).macAddress = "DEMO:room";
  readings.set("demo", { id: "demo", deviceId: ids.device, timestamp: stamp, temperature: 25,
    humidity: 60, soilMoisture: 42, soilMoistureRaw: null, lightLevel: 740 });
  const result = await request(`/devices/${ids.device}/readings`);
  assert.equal(result.body.data[0].simulated, true); assert.equal(result.body.data[0].soilMoistureRaw, null);
  assert.equal(result.body.data[0].lightLux, 740);
});

test("only SuperAdmin can force logout; application cutoff revokes sessions, challenges and proofs atomically", async () => {
  sessions.set("old", { id: "old", userId: ids.owner, revokedAt: null });
  challenges.set("pending", { id: "pending", userId: ids.owner, consumedAt: null });
  proofs.set("owner", { id: "owner", userId: ids.owner });
  const path = `/users/${ids.owner}/revoke-sessions`;
  assert.equal((await request(path, { method: "POST", body: { reason: "Account recovery" } })).status, 403);
  assert.equal(users.get(ids.owner).authVersion, 0);
  const result = await request(path, { role: "admin", method: "POST", body: { reason: "Account recovery" } });
  assert.equal(result.status, 200); assert.equal(result.body.data.authVersion, 1);
  assert.equal(result.body.data.revokedSessions, 1); assert.equal(users.get(ids.owner).isActive, true);
  assert.ok(users.get(ids.owner).authInvalidBefore instanceof Date);
  assert.ok(sessions.get("old").revokedAt instanceof Date); assert.ok(challenges.get("pending").consumedAt instanceof Date);
  assert.equal(proofs.has("owner"), false);
  assert.equal([...audits.values()][0].metadata.providerSessionPolicy, "APPLICATION_CUTOFF");
});
