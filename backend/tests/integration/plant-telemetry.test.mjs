import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, beforeEach, mock, test } from "node:test";
import express from "express";
import { PrismaClient as PostgresClient } from "../../src/generated/postgres-client/index.js";
import { PrismaClient as MongoClient } from "@prisma/client";

const pgUrl = new URL(process.env.POSTGRES_URL ?? "http://invalid");
const mongoUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!/^leafcheck-pairing-test-[\da-f-]+$/.test(process.env.LEAFCHECK_SCAN_TEST_CONTAINER ?? "")
  || pgUrl.hostname !== "127.0.0.1" || pgUrl.pathname !== "/leafcheck_pairing_test"
  || mongoUrl.hostname !== "127.0.0.1" || mongoUrl.pathname !== "/leafcheck_pairing_test") throw new Error("Use the disposable plant-telemetry runner.");
const pg = new PostgresClient({datasources:{db:{url:pgUrl.href}},log:[]});
const mongo = new MongoClient({datasources:{db:{url:mongoUrl.href}},log:[]});
const userId = randomUUID();
let server,base,a,b,device,times,queries,transactions;
const delegatedReadings = new Proxy(mongo.sensorReading,{get(target,key) {
  const value = Reflect.get(target,key);
  if (key === "findMany" || key === "count") return args => {queries.push({method:key,args}); return value.call(target,args);};
  return typeof value === "function" ? value.bind(target) : value;
}});
const measuredMongo = new Proxy(mongo,{get(target,key) {
  if (key === "sensorReading") return delegatedReadings;
  if (key === "$transaction") return operations => {transactions++; return target.$transaction(operations);};
  const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value;
}});
mock.module(new URL("../../src/lib/prisma-pg.js",import.meta.url).href,{namedExports:{prismaPg:pg}});
mock.module(new URL("../../src/lib/prisma.js",import.meta.url).href,{namedExports:{prisma:measuredMongo}});
mock.module(new URL("../../src/lib/auth.js",import.meta.url).href,{namedExports:{requireAuth(req,res,next) {
  const owner = req.get("authorization"); if (!owner) return res.sendStatus(401);
  res.locals.auth={user:{id:owner,role:"USER"}}; next();
}}});
const {plantsRouter} = await import("../../src/routes/plants.ts");
const {telemetryRouter} = await import("../../src/routes/telemetry.ts");
const {errorHandler} = await import("../../src/lib/http.ts");
const {backfillOpenPairingSessions} = await import("../../src/lib/backfill-pairing-sessions.ts");
const {readAdminStats} = await import("../../src/lib/admin-stats.ts");

before(async () => {
  await pg.user.create({data:{id:userId,email:`${userId}@test.invalid`,password:"unused"}});
  const app=express(); app.use(express.json()); app.use("/api/plants",plantsRouter); app.use("/api/telemetry",telemetryRouter); app.use(errorHandler);
  server=app.listen(0,"127.0.0.1"); await new Promise(resolve => server.once("listening",resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});

test("admin stats aggregate actual Mongo timestamps for PostgreSQL-registered physical devices", async () => {
  const asOf = new Date();
  const baseline = await readAdminStats(asOf);
  assert.equal(baseline.meta.telemetryDegraded, false);
  assert.equal(baseline.data.totalUsers, 1);
  await mongo.sensorReading.create({ data: { deviceId: device.macAddress, temperature: 24, humidity: 55, timestamp: asOf } });
  const fresh = await readAdminStats(asOf);
  assert.equal(fresh.data.totalActiveDevices, baseline.data.totalActiveDevices + 1);
  assert.ok(fresh.data.totalPlants >= 2);
  const demo = await pg.device.create({ data: { userId, name: "Stats demo", macAddress: `DEMO:${randomUUID()}` } });
  await mongo.sensorReading.createMany({ data: [
    { deviceId: demo.id, temperature: 24, humidity: 55, timestamp: asOf },
    { deviceId: `unregistered-${randomUUID()}`, temperature: 24, humidity: 55, timestamp: asOf },
  ] });
  assert.equal((await readAdminStats(asOf)).data.totalActiveDevices, fresh.data.totalActiveDevices);
  await mongo.sensorReading.create({ data: { deviceId: device.macAddress, temperature: 24, humidity: 55,
    timestamp: new Date(asOf.getTime() + 61_000) } });
  assert.equal((await readAdminStats(asOf)).data.totalActiveDevices, baseline.data.totalActiveDevices);
});
beforeEach(async () => {
  queries=[]; transactions=0;
  device=await pg.device.create({data:{userId,name:"Movable sensor",macAddress:`LC-${randomBytes(3).toString("hex").toUpperCase()}`}});
  a=await pg.plant.create({data:{userId,name:"Plant1",species:"Fern"}});
  b=await pg.plant.create({data:{userId,name:"Plant2",species:"Fern"}});
  const start=Date.now()-3_600_000;
  times=Array.from({length:5},(_,index) => new Date(start+index*600_000));
});
after(async () => {if(server) await new Promise(resolve => server.close(resolve)); mock.restoreAll(); await pg.$disconnect(); await mongo.$disconnect();});
const get=(path,owner=userId) => fetch(base+path,{headers:owner ? {Authorization:owner} : {}});
async function history(plant=a,query="") {
  const response=await get(`/api/plants/${plant.id}/telemetry/history${query}`);
  assert.equal(response.status,200); return response.json();
}
async function session(plant,start,end=null,sensor=device) {
  const row=await pg.devicePairingHistory.create({data:{plantId:plant.id,deviceId:sensor.id,pairedAt:start,unpairedAt:end}});
  if (end === null) await pg.plant.update({where:{id:plant.id},data:{deviceId:sensor.id}});
  return row;
}
async function tagged(plant,pairing,timestamp,extra={}) {
  return mongo.sensorReading.create({data:{deviceId:device.macAddress,plantId:plant.id,pairingId:pairing.id,contextVersion:1,
    timestamp,temperature:25,humidity:60,soilMoistureRaw:2024,lightLux:1200,...extra}});
}
async function legacy(timestamp,extra={},sensor=device) {
  const id=randomBytes(12).toString("hex");
  await mongo.$runCommandRaw({insert:"sensorReadings",documents:[{_id:{$oid:id},deviceId:sensor.macAddress.startsWith("DEMO:") ? sensor.id : sensor.macAddress,
    deviceTimestamp:{$date:timestamp.toISOString()},temperature:25,humidity:60,soilMoisture:2024,lightLux:1200,...extra}]});
  return id;
}

test("1/12: same MAC is isolated between plants in latest and history",async () => {
  const s1=await session(a,times[0],times[1]),s2=await session(b,times[1]);
  const r1=await tagged(a,s1,times[0]),r2=await tagged(b,s2,times[2]);
  assert.deepEqual((await history(a)).data.map(row => row.id),[r1.id]);
  assert.deepEqual((await history(b)).data.map(row => row.id),[r2.id]);
  const latest=await (await get(`/api/plants/${b.id}/telemetry`)).json();
  assert.equal(latest.telemetry.timestamp,r2.timestamp.toISOString());
  assert.equal((await (await get(`/api/plants/${a.id}/telemetry`)).json()).telemetry,null);
});

test("2/12: Plant1 → Plant2 → Plant1 serves S1+S3 and only S2 for Plant2",async () => {
  const s1=await session(a,times[0],times[1]),s2=await session(b,times[1],times[2]),s3=await session(a,times[2]);
  const r1=await tagged(a,s1,times[0]),r2=await tagged(b,s2,times[1]),r3=await tagged(a,s3,times[3]);
  assert.deepEqual((await history(a)).data.map(row => row.id),[r3.id,r1.id]);
  assert.deepEqual((await history(b)).data.map(row => row.id),[r2.id]);
  assert.equal((await (await get(`/api/plants/${a.id}/telemetry`)).json()).telemetry.timestamp,r3.timestamp.toISOString());
});

test("3/12: an unpaired plant with closed sessions retains its timeline",async () => {
  const s1=await session(a,times[0],times[1]);
  const reading=await tagged(a,s1,times[0]);
  assert.equal((await pg.plant.findUnique({where:{id:a.id}})).deviceId,null);
  assert.deepEqual((await history(a)).data.map(row => row.id),[reading.id]);
});

test("4/12: legacy half-open boundaries belong to the next session, with inclusive starts",async () => {
  await session(a,times[0],times[1]); await session(b,times[1]);
  const start=await legacy(times[0]),boundary=await legacy(times[1]);
  assert.deepEqual((await history(a)).data.map(row => row.id),[start]);
  assert.deepEqual((await history(b)).data.map(row => row.id),[boundary]);
});

test("5/12: fallback accepts missing/null context only inside verified windows",async () => {
  await session(a,times[0],times[2]);
  const missing=await legacy(times[0]);
  const nulls=await legacy(times[1],{plantId:null,pairingId:null,contextVersion:null});
  await legacy(new Date(times[0].getTime()-1)); await legacy(times[2]);
  await legacy(times[1],{pairingId:randomUUID()});
  assert.deepEqual(new Set((await history(a)).data.map(row => row.id)),new Set([missing,nulls]));
});

test("6/12: version-1 unpaired readings never enter any legacy fallback",async () => {
  await session(a,times[0],times[2]); await session(b,times[2]);
  for(const timestamp of [times[1],times[3]]) await legacy(timestamp,{plantId:null,pairingId:null,contextVersion:1});
  assert.equal((await history(a)).pagination.total,0); assert.equal((await history(b)).pagination.total,0);
});

test("7/12: another plant's tag cannot enter fallback despite overlapping timestamp",async () => {
  await session(a,times[0],times[2]); const s2=await session(b,times[2]);
  const reading=await tagged(b,s2,times[1]);
  assert.equal((await history(a)).pagination.total,0);
  assert.deepEqual((await history(b)).data.map(row => row.id),[reading.id]);
});

test("8/12: data/count share identical predicates and one transaction, with consistent pagination",async () => {
  const s1=await session(a,times[0],times[2]);
  await tagged(a,s1,times[0]); await legacy(times[1]); await tagged(a,s1,times[2]);
  const result=await history(a,"?limit=1&offset=1");
  assert.equal(result.data.length,1);
  assert.deepEqual(result.pagination,{total:3,limit:1,offset:1,hasMore:true});
  assert.equal(transactions,1); assert.equal(queries.length,2);
  assert.strictEqual(queries[0].args.where,queries[1].args.where);
  assert.deepEqual(queries[0].args.orderBy,[{timestamp:"desc"},{id:"desc"}]);
});

test("9/12: newest-first timestamps and descending IDs resolve ties deterministically",async () => {
  const s1=await session(a,times[0],times[3]);
  const old=await tagged(a,s1,times[0]);
  const first=await tagged(a,s1,times[2],{id:"000000000000000000000001"});
  const second=await tagged(a,s1,times[2],{id:"000000000000000000000002"});
  assert.deepEqual((await history(a)).data.map(row => row.id),[second.id,first.id,old.id]);
});

test("10/12: a device pointer without a session returns 200 paired-but-empty",async () => {
  await pg.plant.update({where:{id:a.id},data:{deviceId:device.id}});
  await legacy(times[0]);
  const response=await get(`/api/plants/${a.id}/telemetry`);
  assert.equal(response.status,200);
  const result=await response.json(); assert.equal(result.paired,true); assert.equal(result.device.id,device.id); assert.equal(result.telemetry,null);
});

test("11/12: backfill command starts now, logs its count and is idempotent",async () => {
  await pg.plant.update({where:{id:a.id},data:{deviceId:device.id}});
  const before=await pg.devicePairingHistory.findMany({orderBy:{id:"asc"}});
  const candidates=await pg.plant.count({where:{deviceId:{not:null},pairingHistory:{none:{unpairedAt:null}}}});
  const start=Date.now();
  function run() {
    const result=spawnSync(process.execPath,["--import","tsx/esm","scripts/backfill-open-pairing-sessions.mjs"],{cwd:new URL("../../",import.meta.url),env:process.env,encoding:"utf8",timeout:30000});
    assert.equal(result.status,0,"Backfill must succeed against the disposable database"); return result.stdout;
  }
  assert.match(run(),new RegExp(`Created ${candidates} open pairing session`));
  const once=await pg.devicePairingHistory.findMany({orderBy:{id:"asc"}});
  assert.equal(once.length,before.length+candidates);
  const current=once.find(row => row.plantId === a.id && row.unpairedAt === null);
  assert.ok(current.pairedAt.getTime() >= start && current.pairedAt.getTime() <= Date.now());
  assert.match(run(),/Created 0 open pairing session/);
  assert.deepEqual(await pg.devicePairingHistory.findMany({orderBy:{id:"asc"}}),once);
  for(const original of before) assert.deepEqual(once.find(row => row.id === original.id),original);
});

test("12/12: explicit Plant2 attribution stays out of Plant1's timeline",async () => {
  const s1=await session(a,times[0],times[1]),s2=await session(b,times[1]);
  const r1=await tagged(a,s1,times[0]),r2=await tagged(b,s2,times[2]);
  assert.deepEqual((await history(a)).data.map(row => row.id),[r1.id]);
  assert.deepEqual((await history(b)).data.map(row => row.id),[r2.id]);
});

test("date bounds apply to tagged and legacy branches, including ISO offsets",async () => {
  const s1=await session(a,times[0],times[4]);
  await tagged(a,s1,times[0]); const middle=await legacy(times[1]); const taggedMiddle=await tagged(a,s1,times[2]); await legacy(times[3]);
  const query=new URLSearchParams({from:times[1].toISOString(),to:times[2].toISOString()});
  assert.deepEqual((await history(a,`?${query}`)).data.map(row => row.id),[taggedMiddle.id,middle]);
  const shifted=new Date(times[1].getTime()+8*3_600_000).toISOString().replace("Z","+08:00");
  const offset=new URLSearchParams({from:shifted,to:times[2].toISOString()});
  assert.deepEqual((await history(a,`?${offset}`)).data.map(row => row.id),[taggedMiddle.id,middle]);
});

test("history serializes each original demo/physical device while currently unpaired",async () => {
  const demo=await pg.device.create({data:{userId,name:"Demo",macAddress:`DEMO:${a.id}`,status:"SIMULATED"}});
  await session(a,times[0],times[1],demo); await session(a,times[1],times[3]);
  const demoId=await legacy(times[0],{soilMoisture:60,soilMoistureRaw:null,lightLevel:1000},demo);
  const physicalId=await legacy(times[2]);
  const result=await history(a);
  const simulated=result.data.find(row => row.id === demoId),physical=result.data.find(row => row.id === physicalId);
  assert.equal(simulated.deviceId,demo.id); assert.equal(simulated.soilMoisture,60); assert.equal(simulated.soilMoistureRaw,null); assert.equal(simulated.lightLevel,1000);
  assert.equal(physical.deviceId,device.id); assert.equal(physical.soilMoisture,null); assert.equal(physical.soilMoistureRaw,2024); assert.equal(physical.lightLevel,1200);
});

test("tagged context survives a closed-window boundary but live cards require the active session",async () => {
  const s1=await session(a,times[0],times[1]),s2=await session(a,times[2]);
  const delayed=await tagged(a,s1,times[3]);
  assert.deepEqual((await history(a)).data.map(row => row.id),[delayed.id]);
  const latest=await (await get(`/api/plants/${a.id}/telemetry`)).json();
  assert.equal(latest.paired,true); assert.equal(latest.telemetry,null);
  const fresh=await tagged(a,s2,times[2]);
  assert.equal((await (await get(`/api/plants/${a.id}/telemetry`)).json()).telemetry.timestamp,fresh.timestamp.toISOString());
});

test("authorization and malformed pagination/date bounds fail before MongoDB reads",async () => {
  for(const owner of [null,randomUUID()]) assert.equal((await get(`/api/plants/${a.id}/telemetry/history`,owner)).status,owner ? 404 : 401);
  for(const query of ["limit=0","limit=201","limit=1x","limit=1&limit=2","offset=-1","offset=2147483648","from=bad","from=2026-02-30","from=2026-01-02&to=2026-01-01"]) {
    assert.equal((await get(`/api/plants/${a.id}/telemetry/history?${query}`)).status,400,query);
  }
  assert.equal(transactions,0); assert.equal(queries.length,0);
});

test("device diagnostics retain readings from every plant and legacy readings",async () => {
  const s1=await session(a,times[0],times[1]),s2=await session(b,times[1]);
  await tagged(a,s1,times[0]); await tagged(b,s2,times[2]); await legacy(times[3]);
  const response=await get(`/api/telemetry/${device.id}/history`); assert.equal(response.status,200);
  assert.equal((await response.json()).pagination.total,3);
});

test("backfill rolls back all tentative sessions on an injected insert failure",async () => {
  await pg.plant.update({where:{id:a.id},data:{deviceId:device.id}});
  const before=await pg.devicePairingHistory.findMany({orderBy:{id:"asc"}});
  const failing={$transaction(operation,options) {assert.equal(options.isolationLevel,"Serializable"); return pg.$transaction(tx => operation(new Proxy(tx,{get(target,key) {
    if(key !== "devicePairingHistory") return Reflect.get(target,key);
    return new Proxy(target.devicePairingHistory,{get(delegate,method) {
      const value=Reflect.get(delegate,method);
      if(method === "createMany") return async args => {await value.call(delegate,args); throw new Error("injected backfill failure");};
      return typeof value === "function" ? value.bind(delegate) : value;
    }});
  }})),options);}};
  await assert.rejects(backfillOpenPairingSessions(failing),/injected backfill failure/);
  assert.deepEqual(await pg.devicePairingHistory.findMany({orderBy:{id:"asc"}}),before);
});

test("explicit tagged context remains readable without an interval, using the original device metadata",async () => {
  const reading=await mongo.sensorReading.create({data:{deviceId:device.macAddress,plantId:a.id,pairingId:null,contextVersion:1,
    timestamp:times[0],temperature:25,humidity:60,soilMoistureRaw:2024,lightLux:1200}});
  const result=await history(a);
  assert.equal(result.pagination.total,1); assert.equal(result.data[0].id,reading.id);
  assert.equal(result.data[0].deviceId,device.id); assert.equal(result.data[0].soilMoisture,null);
});
