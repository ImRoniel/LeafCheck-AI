import express from "express";
import assert from "node:assert/strict";
import { before, beforeEach, after, mock, test } from "node:test";
import { randomUUID } from "node:crypto";
let server, base;
let devices, readings, calls, failInventory, failedAddresses;
const owner = randomUUID(), other = randomUUID(), plantId = randomUUID();
const now = new Date("2026-10-12T08:00:00Z");
const device = (macAddress, userId = owner, plants = []) => ({ id: randomUUID(), macAddress, name: macAddress, userId, plants, status: "OFFLINE", createdAt: now, updatedAt: now, privateField: "omit" });
const reading = (deviceId, extra = {}) => ({ deviceId, timestamp: now, temperature: 0, humidity: 0, soilMoisture: 2652, soilMoistureRaw: null, lightLux: 500, lightLevel: null, ...extra });
before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href, { namedExports: { requireAuth: (req, res, next) => {
    const id = req.get("authorization"); if (!id) return res.status(401).json({ code: "UNAUTHORIZED" });
    res.locals.auth = { user: { id } }; next();
  } } });
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: { device: { findMany: async query => {
    calls.push(["inventory", query]); if (failInventory) throw new Error("private PG password");
    return devices.filter(device => device.userId === query.where.userId).map(device => ({ ...device, plants: device.plants.filter(plant => plant.userId === query.include.plants.where.userId) }));
  } } } } });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: { sensorReading: { findFirst: async query => {
    calls.push(["reading", query]); if (failedAddresses.has(query.where.deviceId)) throw new Error("private Mongo credentials");
    return readings.filter(reading => reading.deviceId === query.where.deviceId).sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
  } } } } });
  const { devicesRouter } = await import("../src/routes/devices.ts");
  const { errorHandler } = await import("../src/lib/http.ts");
  const app = express(); app.use("/api/devices", devicesRouter); app.use(errorHandler);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/devices/overview`;
});
beforeEach(() => { devices = []; readings = []; calls = []; failInventory = false; failedAddresses = new Set(); });
after(async () => { await new Promise(resolve => server.close(resolve)); mock.restoreAll(); });
const get = (user = owner, query = "") => fetch(base + query, { headers: user ? { Authorization: user } : {} });
test("overview requires authentication before querying either database", async () => {
  assert.equal((await get(null)).status, 401); assert.equal(calls.length, 0);
});
test("inventory is owner-scoped, includes unlinked devices and never queries foreign readings", async () => {
  const linked = { id: plantId, name: "Fern", userId: owner, minMoisture: 40, maxMoisture: 60 };
  const physical = device("LC-A50528", owner, [linked, { ...linked, id: randomUUID(), userId: other, name: "Foreign" }]);
  const unlinked = device("LC-000001"), foreign = device("LC-000002", other);
  devices = [physical, unlinked, foreign]; readings = [reading(physical.macAddress), reading(foreign.macAddress)];
  const response = await get(owner, `?userId=${other}`); assert.equal(response.status, 200); const entries = await response.json();
  assert.equal(entries.length, 2); assert.deepEqual(entries[0].plants, [{ id: plantId, name: "Fern" }]);
  assert.deepEqual(entries[1].plants, []); assert.equal(entries[1].telemetry, null); assert.equal(entries[1].readingError, false);
  assert.equal(entries[0].telemetry.deviceId, physical.id);
  assert.deepEqual(entries[0].telemetry.soilMoisture, { percentage: null, rawAnalogValue: 2652, status: "unavailable" });
  assert.deepEqual(entries[0].telemetry.environment, { temperatureCelsius: 0, humidityPercentage: 0 });
  assert.equal(entries[0].device.macAddress, "LC-A50528"); assert.equal(entries[0].demo, false);
  assert.ok(!JSON.stringify(entries).includes("privateField"));
  assert.equal(calls[0][1].where.userId, owner);
  assert.deepEqual(calls.filter(([type]) => type === "reading").map(([, query]) => query.where.deviceId), [physical.macAddress, unlinked.macAddress]);
});
test("latest physical samples use MACs; demo samples use UUIDs and stay explicitly simulated", async () => {
  const physical = device("LC-A50528"), demo = device(`DEMO:${plantId}`);
  devices = [physical, demo];
  readings = [reading(physical.id, { temperature: 99 }), reading(physical.macAddress, { timestamp: new Date(now.getTime() - 1000), temperature: 20 }), reading(physical.macAddress, { temperature: 26 }), reading(demo.id, { soilMoisture: 50, lightLevel: 1000 })];
  const entries = await (await get()).json();
  assert.equal(entries[0].telemetry.environment.temperatureCelsius, 26);
  assert.equal(entries[0].telemetry.timestamp, now.toISOString());
  assert.equal(entries[1].demo, true); assert.equal(entries[1].telemetry.soilMoisture.percentage, 50);
});
test("one failed telemetry store read preserves device identity and healthy neighbours", async () => {
  devices = [device("LC-A50528"), device("LC-000001")]; readings = [reading("LC-000001")]; failedAddresses.add("LC-A50528");
  const response = await get(); assert.equal(response.status, 200); const entries = await response.json();
  assert.equal(entries[0].device.macAddress, "LC-A50528"); assert.equal(entries[0].readingError, true); assert.equal(entries[0].telemetry, null);
  assert.equal(entries[1].readingError, false); assert.ok(entries[1].telemetry);
  assert.ok(!JSON.stringify(entries).includes("credentials"));
});
test("empty account is explicit, while inventory failures are sanitized errors", async () => {
  assert.deepEqual(await (await get()).json(), []);
  failInventory = true; const response = await get(); assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Internal server error.", code: "INTERNAL_ERROR" });
  assert.equal(calls.filter(([type]) => type === "reading").length, 0);
});
