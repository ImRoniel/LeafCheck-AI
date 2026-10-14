import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { after, before, beforeEach, mock, test } from "node:test";
import express from "express";
import { PrismaClient as PostgresClient } from "../../src/generated/postgres-client/index.js";
import { PrismaClient as MongoClient } from "@prisma/client";

const postgresUrl = new URL(process.env.POSTGRES_URL ?? "http://invalid");
const mongoUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!/^leafcheck-pairing-test-[\da-f-]+$/.test(process.env.LEAFCHECK_SCAN_TEST_CONTAINER ?? "")
  || postgresUrl.hostname !== "127.0.0.1" || postgresUrl.pathname !== "/leafcheck_pairing_test"
  || mongoUrl.hostname !== "127.0.0.1" || mongoUrl.pathname !== "/leafcheck_pairing_test") {
  throw new Error("Use the disposable pairing runner, not application databases.");
}
const postgres = new PostgresClient({datasources:{db:{url:postgresUrl.href}},log:[]});
const mongo = new MongoClient({datasources:{db:{url:mongoUrl.href}},log:[]});
const userId = randomUUID();
let server,base,a,b,device,insertGate,failMongoBatch = false;
const postgresScope = new AsyncLocalStorage();

const pg = new Proxy(postgres,{get(target,key) {
  if (key === "$transaction") return async (operation,options) => {
    assert.equal(options.isolationLevel,"Serializable");
    return target.$transaction(tx => postgresScope.run(true,() => operation(tx)),options);
  };
  const value = Reflect.get(target,key);
  return typeof value === "function" ? value.bind(target) : value;
}});
const sensorReading = new Proxy(mongo.sensorReading,{get(target,key) {
  if (key === "create") return async args => {
    assert.notEqual(postgresScope.getStore(),true,"MongoDB insert must occur after PostgreSQL commit");
    if (insertGate) {insertGate.arrive(); await insertGate.ready;}
    return target.create(args);
  };
  const value = Reflect.get(target,key);
  return typeof value === "function" ? value.bind(target) : value;
}});
const ingestionMongo = new Proxy(mongo,{get(target,key) {
  if (key === "sensorReading") return sensorReading;
  if (key === "$transaction") return async operations => {
    assert.notEqual(postgresScope.getStore(),true,"demo replacement must occur after PostgreSQL commit");
    if (failMongoBatch) throw new Error("injected MongoDB replacement failure");
    return target.$transaction(operations);
  };
  const value = Reflect.get(target,key);
  return typeof value === "function" ? value.bind(target) : value;
}});
mock.module(new URL("../../src/lib/prisma-pg.js",import.meta.url).href,{namedExports:{prismaPg:pg}});
mock.module(new URL("../../src/lib/prisma.js",import.meta.url).href,{namedExports:{prisma:ingestionMongo}});
mock.module(new URL("../../src/lib/auth.js",import.meta.url).href,{namedExports:{requireAuth:(_req,res) => res.sendStatus(401)}});
const {pairPlantDevice} = await import("../../src/lib/plant-pairing.ts");
const {seedDemoTelemetry} = await import("../../src/lib/demo-telemetry.ts");
const {telemetryRouter} = await import("../../src/routes/telemetry.ts");

before(async () => {
  await postgres.user.create({data:{id:userId,email:`${userId}@test.invalid`,password:"unused"}});
  const app = express(); app.use(express.json()); app.use("/api/telemetry",telemetryRouter);
  server = app.listen(0,"127.0.0.1"); await new Promise(resolve => server.once("listening",resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  insertGate = null; failMongoBatch = false;
  device = await postgres.device.create({data:{userId,name:"Movable sensor",macAddress:`LC-${randomBytes(3).toString("hex").toUpperCase()}`}});
  a = await postgres.plant.create({data:{userId,name:"Plant1",species:"Fern"}});
  b = await postgres.plant.create({data:{userId,name:"Plant2",species:"Fern"}});
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  mock.restoreAll(); await postgres.$disconnect(); await mongo.$disconnect();
});
const current = () => postgres.devicePairingHistory.findFirst({where:{deviceId:device.id,unpairedAt:null}});
async function ingest(extra = {}) {
  const response = await fetch(`${base}/api/telemetry`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({deviceId:device.macAddress.toLowerCase(),temperature:25,humidity:60,soilMoisture:2024,lightLux:1200,...extra})});
  assert.equal(response.status,201);
  return response.json();
}

test("Plant1 → Plant2 → Plant1 produces three sessions and retains each reading's attribution", async () => {
  const sessions = [],readings = [];
  const legacy = await mongo.sensorReading.create({data:{deviceId:device.macAddress,temperature:20,humidity:50,timestamp:new Date("2026-01-01")}});
  const legacyRaw = await mongo.sensorReading.findRaw({filter:{_id:{$oid:legacy.id}}});
  for (const plant of [a,b,a]) {
    await pairPlantDevice(plant.id,userId,device.id);
    const session = await current(); sessions.push(session);
    const reading = await ingest(); readings.push(reading);
    assert.equal(reading.plantId,plant.id); assert.equal(reading.pairingId,session.id); assert.equal(reading.contextVersion,1);
  }
  assert.equal(new Set(sessions.map(row => row.id)).size,3);
  assert.equal(await postgres.devicePairingHistory.count({where:{deviceId:device.id}}),3);
  const history = await postgres.devicePairingHistory.findMany({where:{deviceId:device.id}});
  for (let i=0;i<2;i++) assert.equal(history.find(row => row.id === sessions[i].id).unpairedAt.getTime(),sessions[i+1].pairedAt.getTime());
  assert.equal((await current()).plantId,a.id);
  for (const reading of readings) {
    const stored = await mongo.sensorReading.findUnique({where:{id:reading.id}});
    assert.equal(stored.plantId,reading.plantId); assert.equal(stored.pairingId,reading.pairingId);
  }
  assert.equal(await mongo.sensorReading.count({where:{deviceId:device.macAddress,plantId:a.id}}),2);
  assert.equal(await mongo.sensorReading.count({where:{deviceId:device.macAddress,plantId:b.id}}),1);
  assert.deepEqual(await mongo.sensorReading.findRaw({filter:{_id:{$oid:legacy.id}}}),legacyRaw);
});

test("paired ingestion stores the active history UUID alongside the plant UUID", async () => {
  await pairPlantDevice(a.id,userId,device.id);
  const session = await current();
  const reading = await ingest();
  const stored = await mongo.sensorReading.findUnique({where:{id:reading.id}});
  assert.equal(stored.deviceId,device.macAddress); assert.equal(stored.plantId,a.id);
  assert.equal(stored.pairingId,session.id); assert.equal(stored.contextVersion,1);
});

test("unpaired ingestion stores explicit BSON nulls and version 1 despite a legacy pointer", async () => {
  await postgres.plant.update({where:{id:a.id},data:{deviceId:device.id}});
  const reading = await ingest();
  assert.equal(reading.plantId,null); assert.equal(reading.pairingId,null); assert.equal(reading.contextVersion,1);
  const raw = await mongo.sensorReading.findRaw({filter:{_id:{$oid:reading.id}}});
  assert.equal(raw[0].plantId,null); assert.equal(raw[0].pairingId,null); assert.equal(raw[0].contextVersion,1);
  const start = Date.now();
  await pairPlantDevice(a.id,userId,device.id);
  assert.ok((await current()).pairedAt.getTime() >= start);
  assert.equal((await mongo.sensorReading.findUnique({where:{id:reading.id}})).plantId,null);
});

test("a MongoDB insert paused during a real sensor move keeps its resolved session", {timeout:20000}, async t => {
  await pairPlantDevice(a.id,userId,device.id);
  const previous = await current();
  let arrive,release;
  const arrived = new Promise(resolve => {arrive=resolve;});
  insertGate = {arrive,ready:new Promise(resolve => {release=resolve;})};
  t.after(() => release());
  const pending = ingest();
  await arrived;
  await pairPlantDevice(b.id,userId,device.id);
  const next = await current();
  assert.notEqual(next.id,previous.id); assert.equal(next.plantId,b.id);
  release();
  const reading = await pending;
  assert.equal(reading.plantId,a.id); assert.equal(reading.pairingId,previous.id);
  assert.equal((await mongo.sensorReading.findUnique({where:{id:reading.id}})).pairingId,previous.id);
  insertGate = null;
  assert.equal((await ingest()).pairingId,next.id);
});

test("demo reseeding is atomic per session, concurrent-safe and retains older sessions/legacy documents", async () => {
  const seeded = await seedDemoTelemetry(a.id,userId);
  const session = await postgres.devicePairingHistory.findFirst({where:{plantId:a.id,unpairedAt:null}});
  const first = await mongo.sensorReading.findMany({where:{plantId:a.id,pairingId:session.id},orderBy:{id:"asc"}});
  assert.equal(first.length,193);
  assert.ok(first.every(row => row.deviceId === seeded.deviceId && row.contextVersion === 1));
  for (const result of await Promise.all([seedDemoTelemetry(a.id,userId),seedDemoTelemetry(a.id,userId),seedDemoTelemetry(a.id,userId)])) assert.equal(result.deviceId,seeded.deviceId);
  const repeated = await mongo.sensorReading.findMany({where:{plantId:a.id,pairingId:session.id},orderBy:{id:"asc"}});
  assert.equal(repeated.length,193); assert.deepEqual(repeated.map(row => row.id),first.map(row => row.id));
  assert.equal(await postgres.devicePairingHistory.count({where:{plantId:a.id}}),1);
  const legacy = await mongo.sensorReading.create({data:{deviceId:seeded.deviceId,temperature:20,humidity:50}});
  await pairPlantDevice(a.id,userId,null);
  await seedDemoTelemetry(a.id,userId);
  const next = await postgres.devicePairingHistory.findFirst({where:{plantId:a.id,unpairedAt:null}});
  assert.notEqual(next.id,session.id);
  const nextRows = await mongo.sensorReading.findMany({where:{plantId:a.id,pairingId:next.id}});
  assert.equal(nextRows.length,193); assert.ok(nextRows.every(row => !first.some(old => old.id === row.id)));
  assert.deepEqual(await mongo.sensorReading.findMany({where:{plantId:a.id,pairingId:session.id},orderBy:{id:"asc"}}),repeated);
  assert.ok(await mongo.sensorReading.findUnique({where:{id:legacy.id}}));
});

test("a failed demo MongoDB replacement preserves the committed pairing and repairs on retry", async () => {
  failMongoBatch = true;
  await assert.rejects(seedDemoTelemetry(a.id,userId),/injected MongoDB/);
  const session = await postgres.devicePairingHistory.findFirst({where:{plantId:a.id,unpairedAt:null}});
  assert.ok(session); assert.equal((await postgres.plant.findUnique({where:{id:a.id}})).deviceId,session.deviceId);
  assert.equal(await mongo.sensorReading.count({where:{pairingId:session.id}}),0);
  failMongoBatch = false;
  await seedDemoTelemetry(a.id,userId);
  assert.equal(await postgres.devicePairingHistory.count({where:{plantId:a.id}}),1);
  assert.equal(await mongo.sensorReading.count({where:{pairingId:session.id}}),193);
});
