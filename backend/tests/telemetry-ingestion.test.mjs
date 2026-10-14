import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, mock, test } from "node:test";
import express from "express";

const userId = randomUUID(), plantId = randomUUID(), deviceId = randomUUID();
const device = { id: deviceId, userId, name: "Sensor", macAddress: "LC-A50528", status: "ONLINE", createdAt: new Date(), updatedAt: new Date() };
const plant = { id: plantId, userId, name: "Snake plant", species: "Dracaena hyacinthoides", deviceId, imageUrl: "data:image/jpeg;base64,/9j/2Q==", healthStatus: "healthy", minMoisture: 30, maxMoisture: 80 };
let server, base, rows, prompts, queries, activePairing, inTransaction, lookupCount, lookupFailures, insertGate;
const matches = (query, row) => query.where.deviceId === row.deviceId;
before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href, { namedExports: { requireAuth(req, res, next) {
    if (req.get("authorization") !== "owner") return res.sendStatus(401);
    res.locals.auth = { user: { id: userId } }; next();
  } } });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: { sensorReading: {
    create: async ({ data }) => {
      assert.equal(inTransaction,false,"MongoDB writes must follow PostgreSQL commit");
      if (insertGate) { insertGate.arrive(); await insertGate.ready; }
      const row = { id: randomUUID(), ...data }; rows.push(row); return row;
    },
    findFirst: async query => { queries.push(query); return rows.filter(row => matches(query, row)).sort((a,b) => b.timestamp-a.timestamp)[0] ?? null; },
    findMany: async query => rows.filter(row => matches(query, row)).slice(query.skip, query.skip + query.take),
    count: async query => rows.filter(row => matches(query, row)).length,
  } } } });
  const pg = {
    device: { findUnique: async ({ where }) => where.macAddress === device.macAddress ? device : null,
      findFirst: async ({ where }) => where.id === deviceId && where.userId === userId ? device : null,
      findMany: async () => [{ ...device, plants: [plant] }] },
    plant: { findFirst: async ({ where }) => where.id === plantId && where.userId === userId ? plant : null, update: async () => plant },
    plantSpecCache: { findUnique: async () => null }, plantIdentification: { create: async () => ({}) },
    aIAnalysis: { create: async ({ data }) => ({ id: randomUUID(), createdAt: new Date(), ...data }) },
    careTask: { create: async ({ data }) => data },
    devicePairingHistory: { findFirst: async ({where}) => {
      assert.equal(inTransaction,true);
      assert.deepEqual(where,{deviceId,unpairedAt:null});
      lookupCount++;
      return activePairing ? {...activePairing} : null;
    } },
  };
  pg.$transaction = async (operation,options) => {
    assert.equal(options.isolationLevel,"Serializable");
    inTransaction = true;
    try {
      const result = await operation(pg);
      if (lookupFailures-- > 0) throw Object.assign(new Error("conflict before commit"),{code:"P2034"});
      return result;
    } finally { inTransaction = false; }
  };
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: pg } });
  mock.module(new URL("../src/lib/perenual.js", import.meta.url).href, { namedExports: { fetchPlantSpecs: async () => null } });
  mock.module(new URL("../src/lib/gemini.js", import.meta.url).href, { namedExports: {
    geminiModel: () => ({ generateContent: async contents => {
      prompts.push(contents);
      return { response: { text: () => JSON.stringify({ subjectKind: "living_plant", healthStatus: "healthy", diagnosticReport: "Healthy plant.", notification: { notifyAt: "2027-01-01T00:00:00Z", reason: "Check leaves" } }) } };
    } }), geminiError: error => error,
  } });
  const app = express(); app.use(express.json());
  for (const name of ["telemetry", "plants", "devices", "scan"]) {
    const route = await import(`../src/routes/${name}.ts`); app.use(`/api/${name}`, route[`${name}Router`]);
  }
  app.use((await import("../src/lib/http.ts")).errorHandler);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  rows = []; prompts = []; queries = []; inTransaction = false; lookupCount = 0; lookupFailures = 0; insertGate = null;
  activePairing = {id:randomUUID(),plantId};
});
after(async () => { await new Promise(resolve => server.close(resolve)); mock.restoreAll(); });
const payload = { deviceId: "lc-a50528", temperature: 27, humidity: 65, soilMoisture: 2625, soilMoistureRaw: 2625, lightLux: 0.83 };
const post = (path, body, auth = false) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "owner" } : {}) }, body: JSON.stringify(body) });
const get = path => fetch(base + path, { headers: { Authorization: "owner" } });

test("hardware ingestion round-trips through profile, latest, history, overview and saved-photo Gemini diagnosis", async () => {
  const response = await post("/api/telemetry", payload); assert.equal(response.status, 201);
  assert.equal(rows[0].deviceId, "LC-A50528"); assert.equal(rows[0].lightLux, 0.83);
  assert.equal(rows[0].lightLevel, undefined); assert.equal(rows[0].soilMoisture, null); assert.equal(rows[0].soilMoistureRaw, 2625);
  assert.equal(rows[0].plantId,plantId); assert.equal(rows[0].pairingId,activePairing.id); assert.equal(rows[0].contextVersion,1);
  for (const path of [`/api/plants/${plantId}/telemetry`, `/api/telemetry/${deviceId}/latest`]) {
    const result = await get(path); assert.equal(result.status, 200);
    const body = await result.json(), reading = body.telemetry ?? body;
    assert.equal(reading.deviceId, deviceId); assert.equal(reading.lightLevel.lux, 0.83);
    assert.equal(reading.soilMoisture.rawAnalogValue, 2625); assert.equal(reading.soilMoisture.percentage, null);
  }
  const history = await (await get(`/api/telemetry/${deviceId}/history`)).json();
  assert.equal(history.data[0].lightLevel, 0.83); assert.equal(history.pagination.total, 1);
  const overview = await (await get("/api/devices/overview")).json(); assert.equal(overview[0].telemetry.lightLevel.lux, 0.83);
  const diagnosis = await post("/api/scan", { plantId, reusePreviousImage: true }, true);
  assert.equal(diagnosis.status, 201); const scan = await diagnosis.json();
  assert.equal(scan.telemetrySnapshot.deviceId, "LC-A50528"); assert.equal(scan.telemetrySnapshot.simulated, false);
  assert.equal(scan.telemetrySnapshot.timestamp, rows[0].timestamp.toISOString()); assert.equal(scan.telemetrySnapshot.lightLux, 0.83);
  assert.match(prompts[0][0], /Temperature: 27°C/); assert.match(prompts[0][0], /Humidity: 65%/);
  assert.match(prompts[0][0], /Raw ADC: 2625/); assert.match(prompts[0][0], /Ambient Light: 0.83 lux/);
  assert.match(prompts[0][0], /Missing ideal species specs do not mean supplied sensor measurements are missing/);
  assert.equal(prompts[0][1].inlineData.data, "/9j/2Q==");
  assert.ok(queries.every(query => query.where.deviceId === "LC-A50528"));
});

test("legacy firmware lightLevel and percentage are accepted only with explicit raw ADC and normalized", async () => {
  const { lightLux, ...legacy } = payload;
  assert.equal((await post("/api/telemetry", { ...legacy, soilMoisture: 57.3, lightLevel: lightLux })).status, 201);
  assert.equal(rows[0].lightLux, 0.83); assert.equal(rows[0].soilMoistureRaw, 2625); assert.equal(rows[0].soilMoisture, null);
});

test("light aliases preserve zero and reject missing, invalid or contradictory values before writes", async () => {
  const { lightLux, ...body } = payload;
  for (const fields of [{}, { lightLux: null }, { lightLevel: -1 }, { lightLux: "1" }, { lightLux: 0, lightLevel: 2 }]) {
    assert.equal((await post("/api/telemetry", { ...body, ...fields })).status, 400);
  }
  assert.equal(rows.length, 0);
  assert.equal((await post("/api/telemetry", { ...body, lightLevel: 0, lightLux: 0 })).status, 201);
  assert.equal(rows[0].lightLux, 0);
});

test("firmware emits canonical lux and integer raw soil fields", () => {
  const source = readFileSync(new URL("../../hardware/firmware/src/main.cpp", import.meta.url), "utf8");
  assert.match(source, /doc\["lightLux"\]/); assert.doesNotMatch(source, /doc\["lightLevel"\]/);
  assert.match(source, /doc\["soilMoisture"\]\s*=\s*soilRaw/);
});

test("unpaired ingestion writes explicit null context even when a legacy plant pointer exists", async () => {
  activePairing = null;
  const response = await post("/api/telemetry",payload);
  assert.equal(response.status,201);
  const reading = await response.json();
  assert.equal(reading.plantId,null); assert.equal(reading.pairingId,null); assert.equal(reading.contextVersion,1);
  assert.ok(Object.hasOwn(rows[0],"plantId") && Object.hasOwn(rows[0],"pairingId"));
});

test("a paused MongoDB insert preserves the context resolved before a move", async () => {
  const resolved = {...activePairing};
  let arrive,release;
  const arrived = new Promise(resolve => {arrive=resolve;});
  const ready = new Promise(resolve => {release=resolve;});
  insertGate = {arrive,ready};
  const pending = post("/api/telemetry",payload);
  await arrived;
  activePairing = {id:randomUUID(),plantId:randomUUID()};
  release();
  assert.equal((await pending).status,201);
  assert.equal(rows[0].plantId,resolved.plantId); assert.equal(rows[0].pairingId,resolved.id);
  assert.equal(lookupCount,1);
});

test("pairing after an unpaired lookup does not retroactively attribute the in-flight sample", async () => {
  activePairing = null;
  let arrive,release;
  const arrived = new Promise(resolve => {arrive=resolve;});
  insertGate = {arrive,ready:new Promise(resolve => {release=resolve;})};
  const pending = post("/api/telemetry",payload);
  await arrived;
  activePairing = {id:randomUUID(),plantId};
  release();
  assert.equal((await pending).status,201);
  assert.equal(rows[0].plantId,null); assert.equal(rows[0].pairingId,null); assert.equal(rows[0].contextVersion,1);
  assert.equal(lookupCount,1);
});

test("serialization retries finish before the single MongoDB insert", async () => {
  lookupFailures = 2;
  assert.equal((await post("/api/telemetry",payload)).status,201);
  assert.equal(lookupCount,3); assert.equal(rows.length,1);
  lookupFailures = 3;
  assert.equal((await post("/api/telemetry",payload)).status,500);
  assert.equal(rows.length,1);
});

test("firmware cannot supply plant, pairing or context version", async () => {
  for (const fields of [{plantId},{pairingId:randomUUID()},{contextVersion:1}]) {
    assert.equal((await post("/api/telemetry",{...payload,...fields})).status,400);
  }
  assert.equal(lookupCount,0); assert.equal(rows.length,0);
});
