import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, mock, test } from "node:test";
import express from "express";
import { PrismaClient as PostgresClient } from "../../src/generated/postgres-client/index.js";
import { PrismaClient as MongoClient } from "@prisma/client";

const postgresUrl = new URL(process.env.POSTGRES_URL ?? "http://invalid");
const mongoUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!/^leafcheck-pairing-test-[\da-f-]+$/.test(process.env.LEAFCHECK_SCAN_TEST_CONTAINER ?? "")
  || postgresUrl.hostname !== "127.0.0.1" || postgresUrl.pathname !== "/leafcheck_pairing_test"
  || mongoUrl.hostname !== "127.0.0.1" || mongoUrl.pathname !== "/leafcheck_pairing_test")
  throw new Error("Use npm run test:device-transfer with its disposable databases.");

const postgres = new PostgresClient({ datasources: { db: { url: postgresUrl.href } }, log: [] });
const mongo = new MongoClient({ datasources: { db: { url: mongoUrl.href } }, log: [] });
const userA = randomUUID(), userB = randomUUID(), userC = randomUUID();
let server, base, device, plantA, plantB, claimGate, insertGate, failRelease;

const pg = new Proxy(postgres, { get(target, key) {
  if (key === "$transaction") return (operation, options) => target.$transaction(tx => operation(new Proxy(tx, { get(transaction, model) {
    const delegate = Reflect.get(transaction, model);
    if (model !== "device" && model !== "deviceProvision") return delegate;
    return new Proxy(delegate, { get(store, method) {
      const value = Reflect.get(store, method);
      if (model === "device" && method === "findUnique") return async args => {
        const row = await value.call(store, args);
        const gate = claimGate;
        if (gate && args.where.macAddress === gate.macAddress && gate.arrivals < 2) {
          if (++gate.arrivals === 2) gate.release();
          await gate.ready;
        }
        return row;
      };
      if (model === "deviceProvision" && method === "updateMany") return async args => {
        if (failRelease && args.where.claimedDeviceId === device.id) throw new Error("injected release failure");
        return value.call(store, args);
      };
      return typeof value === "function" ? value.bind(store) : value;
    } });
  } })), options);
  const value = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
} });
const ingestionMongo = new Proxy(mongo, { get(target, key) {
  if (key === "sensorReading") return new Proxy(target.sensorReading, { get(store, method) {
    const value = Reflect.get(store, method);
    if (method === "create") return async args => {
      const gate = insertGate;
      if (gate && args.data.deviceId === device.macAddress) { gate.arrive(); await gate.ready; }
      return value.call(store, args);
    };
    return typeof value === "function" ? value.bind(store) : value;
  } });
  const value = Reflect.get(target, key);
  return typeof value === "function" ? value.bind(target) : value;
} });
mock.module(new URL("../../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: pg } });
mock.module(new URL("../../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: ingestionMongo } });
mock.module(new URL("../../src/lib/auth.js", import.meta.url).href, { namedExports: { requireAuth(req, res, next) {
  const id = req.get("authorization");
  if (!id) return res.sendStatus(401);
  res.locals.auth = { user: { id, role: "USER" } }; next();
} } });
const { pairPlantDevice } = await import("../../src/lib/plant-pairing.ts");
const { errorHandler } = await import("../../src/lib/http.ts");
before(async () => {
  await postgres.user.createMany({ data: [userA, userB, userC].map(id => ({ id, email: `${id}@test.invalid`, password: "unused" })) });
  const app = express(); app.use(express.json());
  for (const name of ["devices", "plants", "telemetry"]) {
    const route = await import(`../../src/routes/${name}.ts`);
    app.use(`/api/${name}`, route[`${name}Router`]);
  }
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  claimGate = insertGate = null; failRelease = false;
  device = await postgres.device.create({ data: { userId: userA, name: "A's private sensor name", macAddress: `LC-${randomBytes(3).toString("hex").toUpperCase()}` } });
  await postgres.deviceProvision.create({ data: { macAddress: device.macAddress, claimedDeviceId: device.id } });
  plantA = await postgres.plant.create({ data: { userId: userA, name: "Fern", species: "Fern" } });
  plantB = await postgres.plant.create({ data: { userId: userB, name: "Basil", species: "Basil" } });
  await pairPlantDevice(plantA.id, userA, device.id);
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  mock.restoreAll(); await postgres.$disconnect(); await mongo.$disconnect();
});
const request = (path, user = userA, method = "GET", body) => fetch(base + path, {
  method, headers: { ...(user ? { Authorization: user } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const claim = (user = userB) => request("/api/devices/claim", user, "POST", { macAddress: device.macAddress });
const unpair = (user = userA) => request(`/api/plants/${plantA.id}/pair-device`, user, "PATCH", { deviceId: null });
const release = (user = userA) => request(`/api/devices/${device.id}/release`, user, "POST", {});
const stored = () => postgres.device.findUnique({ where: { id: device.id } });
const provision = () => postgres.deviceProvision.findUnique({ where: { macAddress: device.macAddress } });
async function ingest() {
  const response = await request("/api/telemetry", null, "POST", { deviceId: device.macAddress, temperature: 25, humidity: 60, soilMoisture: 2024, lightLux: 1200 });
  assert.equal(response.status, 201); return response.json();
}
async function transfer() {
  assert.equal((await unpair()).status, 200);
  const response = await claim(); assert.equal(response.status, 200); return response.json();
}

test("A unpairs, B claims the same UUID and pairs it; A's plant history and every reading survive", async () => {
  const old = await ingest();
  const snapshot = await mongo.sensorReading.findUnique({ where: { id: old.id } });
  const denied = await claim(); assert.equal(denied.status, 409); assert.equal((await denied.json()).code, "DEVICE_ALREADY_CLAIMED");
  assert.equal((await unpair()).status, 200);
  assert.equal((await stored()).userId, null);
  assert.equal((await postgres.plant.findUnique({ where: { id: plantA.id } })).deviceId, null);
  assert.ok((await postgres.devicePairingHistory.findUnique({ where: { id: old.pairingId } })).unpairedAt);
  assert.equal((await provision()).claimedDeviceId, null); assert.equal((await provision()).status, "APPROVED");
  const response = await claim(); assert.equal(response.status, 200);
  const claimed = await response.json(); assert.equal(claimed.id, device.id); assert.equal(claimed.userId, userB);
  assert.equal(claimed.name, device.macAddress); assert.equal((await stored()).claimVersion, 1); assert.ok((await stored()).claimedAt);
  assert.equal((await provision()).claimedDeviceId, device.id);
  assert.equal((await request(`/api/plants/${plantB.id}/pair-device`, userB, "PATCH", { deviceId: device.id })).status, 200);
  const fresh = await ingest(); assert.equal(fresh.claimVersion, 1); assert.equal(fresh.plantId, plantB.id);
  const oldHistory = await (await request(`/api/plants/${plantA.id}/telemetry/history`)).json();
  assert.deepEqual(oldHistory.data.map(row => row.id), [old.id]);
  assert.equal((await request(`/api/plants/${plantA.id}/telemetry/history`, userB)).status, 404);
  assert.equal((await request(`/api/telemetry/${device.id}/latest`)).status, 404);
  const newHistory = await (await request(`/api/telemetry/${device.id}/history`, userB)).json();
  assert.deepEqual(newHistory.data.map(row => row.id), [fresh.id]); assert.equal(newHistory.pagination.total, 1);
  assert.deepEqual((await (await request(`/api/plants/${plantB.id}/telemetry/history`, userB)).json()).data.map(row => row.id), [fresh.id]);
  assert.deepEqual(await mongo.sensorReading.findUnique({ where: { id: old.id } }), snapshot);
  assert.equal(await mongo.sensorReading.count({ where: { deviceId: device.macAddress } }), 2);
});

test("new-owner latest, history and overview exclude prior-owner, unowned, legacy and clock-skewed readings", async () => {
  const old = await ingest();
  assert.equal((await unpair()).status, 200);
  const unowned = await ingest(); assert.equal(unowned.claimVersion, null); assert.equal(unowned.plantId, null);
  assert.equal((await claim()).status, 200);
  await mongo.sensorReading.createMany({ data: [
    { deviceId: device.macAddress, plantId: plantA.id, pairingId: old.pairingId, contextVersion: 1, claimVersion: 0, timestamp: new Date(), temperature: 20, humidity: 40 },
    { deviceId: device.macAddress, timestamp: new Date(), temperature: 20, humidity: 40 },
  ] });
  assert.equal((await request(`/api/telemetry/${device.id}/latest`, userB)).status, 404);
  const history = await (await request(`/api/telemetry/${device.id}/history`, userB)).json();
  assert.deepEqual(history.data, []); assert.equal(history.pagination.total, 0);
  const overview = await (await request("/api/devices/overview", userB)).json();
  assert.equal(overview.find(row => row.device.id === device.id).telemetry, null);
  const fresh = await ingest(); assert.equal(fresh.claimVersion, 1); assert.equal(fresh.plantId, null);
  assert.equal((await (await request(`/api/telemetry/${device.id}/history`, userB)).json()).pagination.total, 1);
  const refreshed = await (await request("/api/devices/overview", userB)).json();
  assert.equal(refreshed.find(row => row.device.id === device.id).telemetry.timestamp, fresh.timestamp);
});

test("already-unlinked devices can be released only by their owner; repeated unpair cannot release B's claim", async () => {
  assert.equal((await release(null)).status, 401); assert.equal((await release(userB)).status, 404);
  const paired = await release(); assert.equal(paired.status, 409); assert.equal((await paired.json()).code, "DEVICE_STILL_PAIRED");
  assert.equal((await request(`/api/devices/${device.id}/release`, userA, "POST", { userId: userB })).status, 400);
  await pairPlantDevice(plantA.id, userA, null); // State created by the previous unpair implementation.
  assert.equal((await stored()).userId, userA);
  assert.equal((await release()).status, 204); assert.equal((await stored()).userId, null);
  assert.equal((await claim()).status, 200);
  assert.equal((await unpair()).status, 200); assert.equal((await unpair()).status, 200);
  assert.equal((await release()).status, 404); assert.equal((await stored()).userId, userB);
  assert.equal((await provision()).claimedDeviceId, device.id);
});

test("same-owner reclaims, plant moves, replacement and demo unpairing retain ownership", async () => {
  const before = await stored();
  const reclaimed = await claim(userA); assert.equal(reclaimed.status, 200);
  assert.deepEqual(await stored(), before);
  const another = await postgres.plant.create({ data: { userId: userA, name: "Other fern", species: "Fern" } });
  await pairPlantDevice(another.id, userA, device.id);
  assert.equal((await stored()).userId, userA);
  const demo = await postgres.device.create({ data: { userId: userA, name: "Demo", macAddress: `DEMO:${another.id}`, status: "SIMULATED" } });
  await pairPlantDevice(another.id, userA, demo.id);
  assert.equal((await stored()).userId, userA);
  assert.equal((await request(`/api/plants/${another.id}/pair-device`, userA, "PATCH", { deviceId: null })).status, 200);
  assert.equal((await postgres.device.findUnique({ where: { id: demo.id } })).userId, userA);
  assert.equal((await request(`/api/devices/${demo.id}/release`, userA, "POST", {})).status, 400);
});

test("two simultaneous claims for an unowned device have one owner and one version increment", { timeout: 20000 }, async t => {
  assert.equal((await unpair()).status, 200);
  let releaseGate;
  claimGate = { macAddress: device.macAddress, arrivals: 0, ready: new Promise(resolve => { releaseGate = resolve; }), release: () => releaseGate() };
  t.after(() => releaseGate());
  const responses = await Promise.all([claim(userB), claim(userC)]);
  assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
  const winner = await responses.find(row => row.status === 200).json();
  assert.equal((await stored()).userId, winner.userId); assert.equal((await stored()).claimVersion, 1);
  assert.equal((await provision()).claimedDeviceId, device.id);
  assert.equal((await responses.find(row => row.status === 409).json()).code, "DEVICE_ALREADY_CLAIMED");
});

test("release failure rolls back the owner, plant pointer, history, name and provisioning together", async () => {
  const before = { device: await stored(), provision: await provision(), plant: await postgres.plant.findUnique({ where: { id: plantA.id } }),
    history: await postgres.devicePairingHistory.findMany({ where: { deviceId: device.id } }) };
  failRelease = true;
  const response = await unpair(); assert.equal(response.status, 500); assert.equal((await response.json()).code, "INTERNAL_ERROR");
  failRelease = false;
  assert.deepEqual({ device: await stored(), provision: await provision(), plant: await postgres.plant.findUnique({ where: { id: plantA.id } }),
    history: await postgres.devicePairingHistory.findMany({ where: { deviceId: device.id } }) }, before);
});

test("a delayed MongoDB insertion keeps A's claim and plant context after B takes ownership", { timeout: 20000 }, async t => {
  let arrive, resume;
  const arrived = new Promise(resolve => { arrive = resolve; });
  insertGate = { arrive, ready: new Promise(resolve => { resume = resolve; }) };
  t.after(() => resume());
  const pending = ingest(); await arrived;
  await transfer();
  assert.equal((await request(`/api/plants/${plantB.id}/pair-device`, userB, "PATCH", { deviceId: device.id })).status, 200);
  resume(); const old = await pending; insertGate = null;
  assert.equal(old.claimVersion, 0); assert.equal(old.plantId, plantA.id);
  assert.equal((await request(`/api/telemetry/${device.id}/latest`, userB)).status, 404);
  assert.deepEqual((await (await request(`/api/plants/${plantA.id}/telemetry/history`)).json()).data.map(row => row.id), [old.id]);
  const fresh = await ingest();
  assert.deepEqual((await (await request(`/api/telemetry/${device.id}/history`, userB)).json()).data.map(row => row.id), [fresh.id]);
});

test("an unowned device with a surviving plant assignment cannot be claimed", async () => {
  await postgres.device.update({ where: { id: device.id }, data: { userId: null } });
  const response = await claim(); assert.equal(response.status, 409); assert.equal((await response.json()).code, "DEVICE_STILL_PAIRED");
  assert.equal((await stored()).userId, null); assert.equal((await stored()).claimVersion, 0);
});

test("deleting a later owner preserves the device and earlier owner's pairing history", async () => {
  const old = await ingest();
  const deletingOwner = await postgres.user.create({ data: { email: `${randomUUID()}@test.invalid`, password: "unused" } });
  assert.equal((await unpair()).status, 200); assert.equal((await claim(deletingOwner.id)).status, 200);
  await postgres.user.delete({ where: { id: deletingOwner.id } });
  assert.equal((await stored()).userId, null);
  assert.ok(await postgres.devicePairingHistory.findUnique({ where: { id: old.pairingId } }));
  assert.deepEqual((await (await request(`/api/plants/${plantA.id}/telemetry/history`)).json()).data.map(row => row.id), [old.id]);
  assert.equal((await claim()).status, 200); assert.equal((await stored()).claimVersion, 2);
});

test("hardware revocation and disabled claims still apply to previously released devices", async () => {
  assert.equal((await unpair()).status, 200);
  await postgres.deviceProvision.update({ where: { macAddress: device.macAddress }, data: { status: "REVOKED" } });
  assert.equal((await claim()).status, 403); assert.equal((await stored()).userId, null);
  await postgres.deviceProvision.update({ where: { macAddress: device.macAddress }, data: { status: "APPROVED" } });
  await postgres.platformSettings.upsert({ where: { id: "platform" }, create: { deviceClaimsEnabled: false }, update: { deviceClaimsEnabled: false } });
  try { assert.equal((await claim()).status, 503); assert.equal((await stored()).userId, null); }
  finally { await postgres.platformSettings.update({ where: { id: "platform" }, data: { deviceClaimsEnabled: true } }); }
});

test("the deployment index command adds the claim index and preserves independently managed retention", async () => {
  await mongo.$runCommandRaw({ createIndexes: "sensorReadings", indexes: [{
    key: { timestamp: 1 }, name: "test_managed_retention", expireAfterSeconds: 1036800,
  }] });
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", "scripts/ensure-device-claim-index.mjs"], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: { ...process.env, NODE_ENV: "test" }, encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.status, 0, "index deployment command must succeed");
  const indexes = await mongo.$runCommandRaw({ listIndexes: "sensorReadings" });
  const retention = indexes.cursor.firstBatch.find(index => index.name === "test_managed_retention");
  assert.equal(retention.expireAfterSeconds, 1036800);
  assert.deepEqual(indexes.cursor.firstBatch.find(index => index.name === "sensorReadings_deviceId_claimVersion_deviceTimestamp_idx").key,
    { deviceId: 1, claimVersion: 1, deviceTimestamp: -1 });
});
