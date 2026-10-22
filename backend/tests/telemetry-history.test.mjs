import express from "express";
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { matchesWhere } from "./helpers/mongo-filter.mjs";

const deviceId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-12T00:00:00.000Z");
let server, base, device, readings, queries;
const sample = (index, extra = {}) => ({
  id: String(index), deviceId: "LC-A50528",
  timestamp: new Date(now.getTime() - index * 60000),
  temperature: 25, humidity: 50, soilMoisture: 2652,
  soilMoistureRaw: null, lightLevel: null, lightLux: 10.83, ...extra,
});

before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href, {
    namedExports: { requireAuth(req, res, next) {
      if (!req.get("authorization")) return res.sendStatus(401);
      res.locals.auth = { user: { id: req.get("authorization") } }; next();
    } },
  });
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {
    namedExports: { prismaPg: { device: { findFirst: async ({ where }) =>
      where.id === device.id && where.userId === "owner" ? device : null,
    } } },
  });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, {
    namedExports: { prisma: { sensorReading: {
      findMany: async (query) => {
        queries.push(query);
        return readings.filter(row => matchesWhere(row, query.where))
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(query.skip, query.skip + query.take);
      },
      count: async (query) => {
        queries.push(query);
        return readings.filter(row => matchesWhere(row, query.where)).length;
      },
    } } },
  });
  const { telemetryRouter } = await import("../src/routes/telemetry.ts");
  const { errorHandler } = await import("../src/lib/http.ts");
  const app = express(); app.use("/api/telemetry", telemetryRouter); app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/telemetry`;
});
beforeEach(() => {
  device = { id: deviceId, macAddress: "LC-A50528" };
  readings = Array.from({ length: 66 }, (_, index) => sample(index)).reverse();
  readings.push(sample(-1, { deviceId }), sample(-2, { deviceId: "LC-000001" }));
  queries = [];
});
after(async () => { await new Promise(resolve => server.close(resolve)); mock.restoreAll(); });
const request = (query = "", user = "owner", id = deviceId) =>
  fetch(`${base}/${id}/history${query}`, { headers: user ? { Authorization: user } : {} });

test("hardware history resolves the authorized UUID to MAC for both page and count", async () => {
  const response = await request("?limit=200&offset=0");
  assert.equal(response.status, 200);
  const body = await response.json();
  const where = queries[0].where;
  assert.equal(where.deviceId, "LC-A50528"); assert.ok(where.timestamp.lte instanceof Date);
  assert.deepEqual(where.OR, [{claimVersion:0},{claimVersion:null},{claimVersion:{isSet:false}}]);
  assert.deepEqual(queries, [
    { where, orderBy: { timestamp: "desc" }, take: 200, skip: 0 },
    { where },
  ]);
  assert.deepEqual(body.pagination, { total: 66, limit: 200, offset: 0, hasMore: false });
  assert.equal(body.data.length, 66);
  assert.deepEqual(body.data[0], {
    id: "0", deviceId, timestamp: now.toISOString(), temperature: 25, humidity: 50,
    soilMoisture: null, soilMoistureRaw: 2652, lightLevel: 10.83,
  });
  assert.equal(body.data.at(-1).id, "65");
});
test("pagination defaults, offsets, final and empty pages, and bounds retain the full MAC count", async () => {
  for (const [query, limit, offset, length, hasMore] of [
    ["", 50, 0, 50, true],
    ["?limit=10&offset=10", 10, 10, 10, true],
    ["?limit=10&offset=60", 10, 60, 6, false],
    ["?limit=10&offset=66", 10, 66, 0, false],
    ["?limit=999&offset=-1", 200, 0, 66, false],
    ["?limit=-1", 1, 0, 1, true],
  ]) {
    const body = await (await request(query)).json();
    assert.deepEqual(body.pagination, { total: 66, limit, offset, hasMore });
    assert.equal(body.data.length, length);
    if (length) assert.equal(body.data[0].id, String(offset));
  }
});
test("demo history retains UUID lookup and calibrated percentage and light fields", async () => {
  device.macAddress = "DEMO:plant";
  readings = [sample(0, { deviceId, soilMoisture: 50, lightLevel: 1200 })];
  const body = await (await request()).json();
  assert.deepEqual(queries[0].where, { deviceId });
  assert.equal(body.pagination.total, 1);
  assert.equal(body.data[0].soilMoisture, 50);
  assert.equal(body.data[0].soilMoistureRaw, null);
  assert.equal(body.data[0].lightLevel, 1200);
});
test("hardware history preserves raw ADC, zero light, and unavailable sensor values", async () => {
  readings = [sample(0, { soilMoistureRaw: 0, lightLux: 0 }),
    sample(1, { soilMoisture: null, soilMoistureRaw: null, lightLux: null })];
  const body = await (await request()).json();
  assert.equal(body.data[0].soilMoistureRaw, 0);
  assert.equal(body.data[0].lightLevel, 0);
  assert.equal(body.data[1].soilMoistureRaw, null);
  assert.equal(body.data[1].lightLevel, null);
});
test("physical history never falls back to UUID documents", async () => {
  readings = [sample(0, { deviceId })];
  const body = await (await request()).json();
  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.total, 0);
});
test("anonymous, foreign, and invalid device requests stop before Mongo queries", async () => {
  assert.equal((await request("", null)).status, 401);
  assert.equal((await request("", "other")).status, 404);
  assert.equal((await request("", "owner", "LC-A50528")).status, 400);
  assert.deepEqual(queries, []);
});

test("a transferred device's page and count include only its current claim within the ownership boundary", async () => {
  device.claimVersion = 2; device.claimedAt = new Date(now.getTime() - 60000);
  readings = [sample(0,{claimVersion:2}),sample(0,{claimVersion:1}),sample(0),sample(0,{claimVersion:null}),
    sample(2,{claimVersion:2}),sample(0,{claimVersion:2,timestamp:new Date(Date.now()+60000)})];
  const body = await (await request()).json();
  assert.equal(body.pagination.total,1); assert.equal(body.data.length,1); assert.equal(body.data[0].id,"0");
  assert.equal(queries[0].where.claimVersion,2); assert.equal(queries[1].where.claimVersion,2);
});
