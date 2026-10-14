import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { PrismaClient as MongoDBClient } from "@prisma/client";
import { PrismaClient as PostgreSQLClient } from "../../src/generated/postgres-client/index.js";

const testId = process.env.LEAFCHECK_TELEMETRY_SCHEMA_TEST_ID ?? "";
const postgresUrl = new URL(process.env.POSTGRES_URL ?? "http://invalid");
const duplicateUrl = new URL(process.env.LEAFCHECK_TELEMETRY_SCHEMA_DUPLICATE_URL ?? "http://invalid");
const mongoUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!/^[0-9a-f-]{36}$/.test(testId)
  || postgresUrl.protocol !== "postgresql:" || postgresUrl.hostname !== "127.0.0.1" || postgresUrl.pathname !== "/leafcheck_phase_a_test"
  || duplicateUrl.protocol !== "postgresql:" || duplicateUrl.host !== postgresUrl.host || duplicateUrl.pathname !== "/leafcheck_phase_a_duplicates"
  || mongoUrl.protocol !== "mongodb:" || mongoUrl.hostname !== "127.0.0.1" || mongoUrl.pathname !== "/leafcheck_phase_a_test") {
  throw new Error("Use the disposable telemetry-schema runner, not application databases.");
}

const pg = new PostgreSQLClient({ datasources: { db: { url: postgresUrl.href } }, log: [] });
const duplicates = new PostgreSQLClient({ datasources: { db: { url: duplicateUrl.href } }, log: [] });
const mongo = new MongoDBClient({ datasources: { db: { url: mongoUrl.href } }, log: [] });
const require = createRequire(import.meta.url);
const prisma = join(dirname(require.resolve("prisma/package.json")), "build/index.js");
const start = new Date("2026-10-14T00:00:00.000Z");
const boundary = new Date("2026-10-14T00:01:00.000Z");
const later = new Date("2026-10-14T00:02:00.000Z");
let original;
let legacyReading;
let nullReading;
let taggedReading;
let unpairedReading;
let originalMongoDocuments;

function prismaCommand(args, url = postgresUrl) {
  const result = spawnSync(process.execPath, [prisma, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, POSTGRES_URL: url.href, DIRECT_URL: url.href, DATABASE_URL: mongoUrl.href },
    encoding: "utf8", timeout: 60_000,
  });
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    .replaceAll(postgresUrl.password, "[test credential]");
  return { status: result.status, diagnostic };
}

async function fixture(client = pg) {
  const id = randomUUID();
  const user = await client.user.create({ data: { email: `${id}@test.invalid`, password: "unused" } });
  const device = await client.device.create({ data: { name: "Movable sensor", macAddress: `TEST:${id}`, userId: user.id } });
  const otherDevice = await client.device.create({ data: { name: "Other sensor", macAddress: `OTHER:${id}`, userId: user.id } });
  const plant = await client.plant.create({ data: { name: "Plant1", species: "Fern", userId: user.id, deviceId: device.id } });
  const otherPlant = await client.plant.create({ data: { name: "Plant2", species: "Fern", userId: user.id } });
  return { user, device, otherDevice, plant, otherPlant };
}

const session = (value, overrides = {}) => ({ deviceId: value.device.id, plantId: value.plant.id, pairedAt: start, ...overrides });
const snapshot = async () => ({
  users: await pg.user.findMany({ orderBy: { id: "asc" } }),
  devices: await pg.device.findMany({ orderBy: { id: "asc" } }),
  plants: await pg.plant.findMany({ orderBy: { id: "asc" } }),
});

before(async () => {
  await fixture();
  original = await snapshot();
  const migration = prismaCommand(["migrate", "deploy", "--schema=prisma/schema.postgres.prisma"]);
  assert.equal(migration.status, 0, migration.diagnostic);

  const measurements = { deviceId: "LC-A50528", temperature: 27, humidity: 60, soilMoistureRaw: 2600, lightLux: 1000, timestamp: start };
  legacyReading = await mongo.sensorReading.create({ data: measurements });
  nullReading = await mongo.sensorReading.create({ data: { ...measurements, plantId: null, pairingId: null, contextVersion: null } });
  taggedReading = await mongo.sensorReading.create({ data: { ...measurements, plantId: randomUUID(), pairingId: randomUUID(), contextVersion: 1 } });
  unpairedReading = await mongo.sensorReading.create({ data: { ...measurements, plantId: null, pairingId: null, contextVersion: 1 } });
  originalMongoDocuments = await mongo.sensorReading.findRaw({ options: { sort: { _id: 1 } } });
  const indexes = prismaCommand(["db", "push", "--schema=prisma/schema.prisma", "--skip-generate"]);
  assert.equal(indexes.status, 0, indexes.diagnostic);
});

after(async () => { await Promise.allSettled([pg.$disconnect(), duplicates.$disconnect(), mongo.$disconnect()]); });

test("additive PostgreSQL migration preserves existing rows and seeds no inferred history", async () => {
  assert.deepEqual(await snapshot(), original);
  assert.equal(await pg.devicePairingHistory.count(), 0);
});

test("current-holder constraint rejects a second plant while permitting multiple unpaired plants", async () => {
  const value = await fixture();
  await assert.rejects(pg.plant.update({ where: { id: value.otherPlant.id }, data: { deviceId: value.device.id } }), { code: "P2002" });
  assert.equal((await pg.plant.findUnique({ where: { id: value.plant.id } })).deviceId, value.device.id);
  assert.equal((await pg.plant.findUnique({ where: { id: value.otherPlant.id } })).deviceId, null);
  const extra = await pg.plant.create({ data: { name: "Unpaired", species: "Fern", userId: value.user.id } });
  assert.equal(extra.deviceId, null);
});

test("current plant link and history reject nonexistent device or plant UUIDs", async () => {
  const value = await fixture();
  await assert.rejects(pg.plant.update({ where: { id: value.otherPlant.id }, data: { deviceId: randomUUID() } }), { code: "P2003" });
  await assert.rejects(pg.devicePairingHistory.create({ data: session(value, { deviceId: randomUUID() }) }), { code: "P2003" });
  await assert.rejects(pg.devicePairingHistory.create({ data: session(value, { plantId: randomUUID() }) }), { code: "P2003" });
});

test("open-session constraints enforce one plant per device and one device per plant", async () => {
  const value = await fixture();
  await pg.devicePairingHistory.create({ data: session(value) });
  await assert.rejects(pg.devicePairingHistory.create({ data: session(value, { plantId: value.otherPlant.id }) }), { code: "P2002" });
  await assert.rejects(pg.devicePairingHistory.create({ data: session(value, { deviceId: value.otherDevice.id }) }), { code: "P2002" });
  await pg.devicePairingHistory.create({ data: session(value, { deviceId: value.otherDevice.id, plantId: value.otherPlant.id }) });
  assert.equal(await pg.devicePairingHistory.count({ where: { plant: { userId: value.user.id }, unpairedAt: null } }), 2);
});

test("closing, moving and returning preserves every session and both relation lists", async () => {
  const value = await fixture();
  const first = await pg.devicePairingHistory.create({ data: session(value) });
  await pg.devicePairingHistory.update({ where: { id: first.id }, data: { unpairedAt: boundary } });
  const second = await pg.devicePairingHistory.create({ data: session(value, { plantId: value.otherPlant.id, pairedAt: boundary }) });
  await pg.devicePairingHistory.update({ where: { id: second.id }, data: { unpairedAt: later } });
  const third = await pg.devicePairingHistory.create({ data: session(value, { pairedAt: later }) });
  const device = await pg.device.findUnique({ where: { id: value.device.id }, include: { pairingHistory: { orderBy: { pairedAt: "asc" } }, plants: true } });
  assert.deepEqual(device.pairingHistory.map(row => row.id), [first.id, second.id, third.id]);
  assert.equal(device.pairingHistory[0].unpairedAt.getTime(), device.pairingHistory[1].pairedAt.getTime());
  assert.equal(device.pairingHistory[1].unpairedAt.getTime(), device.pairingHistory[2].pairedAt.getTime());
  assert.ok(Array.isArray(device.plants));
  const plant = await pg.plant.findUnique({ where: { id: value.plant.id }, include: { pairingHistory: { orderBy: { pairedAt: "asc" } } } });
  assert.deepEqual(plant.pairingHistory.map(row => row.id), [first.id, third.id]);
});

test("interval check rejects reversed dates and permits a zero-duration closed interval", async () => {
  const value = await fixture();
  await assert.rejects(pg.devicePairingHistory.create({ data: session(value, { pairedAt: boundary, unpairedAt: start }) }), /DevicePairingHistory_interval_check/);
  const empty = await pg.devicePairingHistory.create({ data: session(value, { unpairedAt: start }) });
  assert.equal(empty.pairedAt.getTime(), empty.unpairedAt.getTime());
  const open = await pg.devicePairingHistory.create({ data: { deviceId: value.device.id, plantId: value.plant.id } });
  assert.ok(open.pairedAt instanceof Date);
  await assert.rejects(pg.devicePairingHistory.update({ where: { id: open.id }, data: { unpairedAt: new Date(open.pairedAt.getTime() - 1) } }), /DevicePairingHistory_interval_check/);
  assert.equal((await pg.devicePairingHistory.findUnique({ where: { id: open.id } })).unpairedAt, null);
});

test("constraint failure rolls back closure and insertion together", async () => {
  const value = await fixture();
  const first = await pg.devicePairingHistory.create({ data: session(value) });
  await pg.devicePairingHistory.create({ data: session(value, { deviceId: value.otherDevice.id, plantId: value.otherPlant.id }) });
  await assert.rejects(pg.$transaction(async tx => {
    await tx.devicePairingHistory.update({ where: { id: first.id }, data: { unpairedAt: boundary } });
    await tx.devicePairingHistory.create({ data: session(value, { plantId: value.otherPlant.id, pairedAt: boundary }) });
  }), { code: "P2002" });
  assert.equal((await pg.devicePairingHistory.findUnique({ where: { id: first.id } })).unpairedAt, null);
  assert.equal(await pg.devicePairingHistory.count({ where: { plant: { userId: value.user.id } } }), 2);
});

test("device deletion cannot erase a plant's recorded history", async () => {
  const value = await fixture();
  const recorded = await pg.devicePairingHistory.create({ data: session(value, { unpairedAt: boundary }) });
  await assert.rejects(pg.device.delete({ where: { id: value.device.id } }), { code: "P2003" });
  assert.ok(await pg.devicePairingHistory.findUnique({ where: { id: recorded.id } }));
  assert.equal((await pg.plant.findUnique({ where: { id: value.plant.id } })).deviceId, value.device.id);
});

test("explicit plant deletion cascades only its sessions", async () => {
  const value = await fixture();
  await pg.devicePairingHistory.create({ data: session(value, { unpairedAt: boundary }) });
  const other = await pg.devicePairingHistory.create({ data: session(value, { plantId: value.otherPlant.id, pairedAt: boundary }) });
  await pg.plant.delete({ where: { id: value.plant.id } });
  assert.equal(await pg.devicePairingHistory.count({ where: { plantId: value.plant.id } }), 0);
  assert.ok(await pg.devicePairingHistory.findUnique({ where: { id: other.id } }));
  assert.ok(await pg.device.findUnique({ where: { id: value.device.id } }));
});

test("existing user-deletion cascades can remove that user's plants and sessions", async () => {
  const value = await fixture();
  await pg.devicePairingHistory.create({ data: session(value, { unpairedAt: boundary }) });
  await pg.user.delete({ where: { id: value.user.id } });
  assert.equal(await pg.devicePairingHistory.count({ where: { plantId: value.plant.id } }), 0);
  assert.equal(await pg.device.count({ where: { userId: value.user.id } }), 0);
});

test("duplicate current links fail the migration atomically and remain unreconciled", async () => {
  const value = await fixture(duplicates);
  await duplicates.plant.update({ where: { id: value.otherPlant.id }, data: { deviceId: value.device.id } });
  const before = await duplicates.plant.findMany({ where: { userId: value.user.id }, orderBy: { id: "asc" } });
  const migration = prismaCommand(["migrate", "deploy", "--schema=prisma/schema.postgres.prisma"], duplicateUrl);
  assert.notEqual(migration.status, 0);
  assert.match(migration.diagnostic, /Plant_deviceId_current_key/);
  assert.deepEqual(await duplicates.plant.findMany({ where: { userId: value.user.id }, orderBy: { id: "asc" } }), before);
  assert.equal(await duplicates.plant.count({ where: { deviceId: value.device.id } }), 2);
  await assert.rejects(duplicates.devicePairingHistory.count(), { code: "P2021" });
});

test("MongoDB index synchronization preserves every existing document", async () => {
  assert.equal(await mongo.sensorReading.count(), 4);
  assert.deepEqual(await mongo.sensorReading.findRaw({ options: { sort: { _id: 1 } } }), originalMongoDocuments);
});

test("legacy readings remain readable without materializing plant, pairing or version fields", async () => {
  const reading = await mongo.sensorReading.findUnique({ where: { id: legacyReading.id } });
  assert.equal(reading.plantId, null);
  assert.equal(reading.pairingId, null);
  assert.equal(reading.contextVersion, null);
  const documents = await mongo.sensorReading.findRaw({ filter: {
    _id: { $oid: legacyReading.id }, plantId: { $exists: false },
    pairingId: { $exists: false }, contextVersion: { $exists: false },
  } });
  assert.ok(Array.isArray(documents));
  assert.equal(documents.length, 1);
});

test("MongoDB distinguishes missing context fields from explicit nulls", async () => {
  const missing = await mongo.sensorReading.findMany({ where: { contextVersion: { isSet: false } } });
  assert.deepEqual(missing.map(row => row.id), [legacyReading.id]);
  const nulls = await mongo.sensorReading.findMany({ where: { contextVersion: null } });
  assert.deepEqual(nulls.map(row => row.id), [nullReading.id]);
  const legacy = await mongo.sensorReading.findMany({ where: { OR: [{ contextVersion: null }, { contextVersion: { isSet: false } }] } });
  assert.deepEqual(new Set(legacy.map(row => row.id)), new Set([legacyReading.id, nullReading.id]));
});

test("attributed readings retain PostgreSQL UUID strings instead of requiring MongoDB ObjectIds", async () => {
  const reading = await mongo.sensorReading.findUnique({ where: { id: taggedReading.id } });
  assert.equal(reading.plantId, taggedReading.plantId);
  assert.equal(reading.pairingId, taggedReading.pairingId);
  assert.match(reading.plantId, /^[0-9a-f-]{36}$/);
  assert.match(reading.pairingId, /^[0-9a-f-]{36}$/);
  assert.equal(reading.contextVersion, 1);
});

test("version-1 unpaired readings are distinct from legacy readings with unknown context", async () => {
  const reading = await mongo.sensorReading.findUnique({ where: { id: unpairedReading.id } });
  assert.equal(reading.plantId, null);
  assert.equal(reading.pairingId, null);
  assert.equal(reading.contextVersion, 1);
  const legacy = await mongo.sensorReading.count({ where: {
    id: unpairedReading.id, OR: [{ contextVersion: null }, { contextVersion: { isSet: false } }],
  } });
  assert.equal(legacy, 0);
});

for (const field of ["deviceId", "plantId", "pairingId"]) {
  test(`MongoDB ${field} history index uses the mapped deviceTimestamp field`, async () => {
    const result = await mongo.$runCommandRaw({ listIndexes: "sensorReadings", cursor: {} });
    const indexes = result.cursor?.firstBatch;
    assert.ok(Array.isArray(indexes));
    assert.ok(indexes.some(index => index.key?.[field] === 1 && index.key?.deviceTimestamp === -1
      && Object.keys(index.key).length === 2));
    assert.ok(indexes.every(index => !Object.hasOwn(index.key, "timestamp")));
  });
}
