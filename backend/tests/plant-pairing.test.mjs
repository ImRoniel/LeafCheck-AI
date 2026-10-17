import express from "express";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";

let server, base, plants, devices, histories, attempts, version, conflictCount, conflictError, failUpdate, vanish, deviceChecks, concurrencyGate;
const owner = "owner";
const a = randomUUID(), b = randomUUID(), hardware = randomUUID(), previous = randomUUID();
const row = (id, userId = owner, deviceId = null) => ({ id, userId, deviceId, name: "Fern", species: "Fern", minMoisture: 30, maxMoisture: 80, healthStatus: "unknown", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") });
const find = (rows, where) => rows.get(where.id)?.userId === where.userId ? { ...rows.get(where.id) } : null;
const matchesHistory = (row, where) => where.OR.some(filter => Object.entries(filter).every(([key,value]) => row[key] === value))
  && (where.unpairedAt === null ? row.unpairedAt === null : row.unpairedAt !== null);
const client = {
  plant: { findFirst: async ({where}) => find(plants, where) },
  device: { findFirst: async () => { throw new Error("device ownership must run through tx"); } },
  async $transaction(operation, options) {
    assert.equal(options.isolationLevel, "Serializable");
    attempts++;
    const revision = version;
    const local = new Map([...plants].map(([id, plant]) => [id, {...plant}]));
    const localHistory = structuredClone(histories);
    if (concurrencyGate && concurrencyGate.arrivals < 2) {
      concurrencyGate.arrivals++;
      if (concurrencyGate.arrivals === 2) concurrencyGate.release();
      await concurrencyGate.ready;
    }
    const tx = {
      plant: {
        findFirst: async ({where}) => vanish ? null : find(local, where),
        async updateMany({where, data}) {
          assert.ok([a,b].includes(where.id.not));
          let count = 0;
          for (const plant of local.values()) if (plant.deviceId === where.deviceId && plant.id !== where.id.not) { Object.assign(plant, data); count++; }
          return {count};
        },
        async update({where, data}) {
          assert.equal(where.userId, owner);
          if (failUpdate) throw new Error("private storage failure after unpair");
          const plant = find(local, where);
          if (!plant) throw Object.assign(new Error("gone"), {code:"P2025"});
          Object.assign(plant, data); local.set(plant.id, plant); return plant;
        },
      },
      device: { findFirst: async ({where}) => { deviceChecks++; return find(devices, where); } },
      devicePairingHistory: {
        findMany: async ({where}) => localHistory.filter(row => matchesHistory(row, where)),
        findFirst: async ({where}) => localHistory.filter(row => matchesHistory(row, where)).sort((a,b) => b.unpairedAt-a.unpairedAt)[0] ?? null,
        updateMany: async ({where,data}) => {
          const affected = localHistory.filter(row => matchesHistory(row, where));
          for (const row of affected) Object.assign(row, data);
          return {count:affected.length};
        },
        create: async ({data}) => {
          const row = {id:randomUUID(), unpairedAt:null, ...data}; localHistory.push(row); return row;
        },
      },
    };
    const result = await operation(tx);
    if (conflictCount > 0 || version !== revision) {
      conflictCount = Math.max(0, conflictCount - 1);
      throw conflictError ?? Object.assign(new Error("serialization conflict"), {code:"P2034"});
    }
    plants = local; histories = localHistory; version++;
    return result;
  },
};
before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href, {namedExports:{requireAuth(req,res,next) {
    const id = req.get("authorization"); if (!id) return res.status(401).json({code:"UNAUTHORIZED"});
    res.locals.auth = {user:{id,role:"USER"}}; next();
  }}});
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {namedExports:{prismaPg:client}});
  mock.module(new URL("../src/lib/demo-telemetry.js", import.meta.url).href, {namedExports:{demoDeviceId: id => `demo-${id}`, seedDemoTelemetry: async () => {throw new Error("unexpected demo call");}}});
  const {plantsRouter} = await import("../src/routes/plants.ts");
  const {errorHandler} = await import("../src/lib/http.ts");
  const app = express(); app.use(express.json()); app.use("/api/plants",plantsRouter); app.use(errorHandler);
  server = app.listen(0,"127.0.0.1"); await new Promise(resolve => server.once("listening",resolve));
  base = `http://127.0.0.1:${server.address().port}/api/plants`;
});
beforeEach(() => {
  plants = new Map([[a,row(a)], [b,row(b,owner,hardware)]]);
  devices = new Map([[hardware,{id:hardware,userId:owner}], [previous,{id:previous,userId:owner}]]);
  histories = [{id:randomUUID(), plantId:b, deviceId:hardware, pairedAt:new Date("2026-01-01"), unpairedAt:null}];
  attempts = version = conflictCount = deviceChecks = 0; failUpdate = vanish = false; concurrencyGate = null;
  conflictError = null;
});
after(async () => {if(server) await new Promise(resolve => server.close(resolve)); mock.restoreAll();});
async function request(body, id = a, user = owner) {
  return fetch(`${base}/${id}/pair-device`, {method:"PATCH",headers:{"Content-Type":"application/json",...(user ? {Authorization:user} : {})},body:JSON.stringify(body)});
}
test("rejects invalid input, UUIDs, foreign and missing resources before writes", async () => {
  for (const body of [null,[],{}, {deviceId:42}, {deviceId:false}, {deviceId:"bad"}, {deviceId:hardware,userId:"other"}]) assert.equal((await request(body)).status,400);
  assert.equal((await request({deviceId:hardware},"bad")).status,400);
  assert.equal((await request({deviceId:null},a,null)).status,401);
  for (const id of [a,randomUUID()]) {const response = await request({deviceId:hardware},id,"other"); assert.equal(response.status,404); assert.equal((await response.json()).code,"NOT_FOUND");}
  assert.equal(attempts,0);
  for (const deviceId of [randomUUID(),previous]) {
    devices.get(previous).userId = "other";
    const response = await request({deviceId}); assert.equal(response.status,404); assert.equal((await response.json()).code,"NOT_FOUND");
    assert.equal(plants.get(b).deviceId,hardware); assert.equal(plants.get(a).deviceId,null);
  }
});
test("auto-unpairs all previous holders, replaces the target association and preserves Plant serialization", async () => {
  plants.set(a,row(a,owner,previous));
  histories.push({id:randomUUID(),plantId:a,deviceId:previous,pairedAt:new Date("2026-01-02"),unpairedAt:null});
  const corrupt = randomUUID(); plants.set(corrupt,row(corrupt,"other",hardware));
  const response = await request({deviceId:hardware}); assert.equal(response.status,200);
  const plant = await response.json(); assert.equal(plant.deviceId,hardware); assert.equal(plant.id,a); assert.equal(plant.userId,undefined); assert.equal(plant.simulated,false); assert.equal(plant.createdAt,"2026-01-01T00:00:00.000Z");
  assert.equal(plants.get(b).deviceId,null); assert.equal(plants.get(corrupt).deviceId,null); assert.equal(deviceChecks,1);
  assert.equal(histories.length,3);
  assert.equal(histories[0].unpairedAt.getTime(),histories[2].pairedAt.getTime());
  assert.equal(histories[1].unpairedAt.getTime(),histories[2].pairedAt.getTime());
  assert.equal(histories[2].plantId,a);
});
test("unpair is repeatable, returns existing omitted-null contract and never checks a device", async () => {
  plants.set(a,row(a,owner,hardware));
  for(let i=0;i<2;i++) {const response = await request({deviceId:null}); assert.equal(response.status,200); assert.equal((await response.json()).deviceId,undefined); assert.equal(plants.get(a).deviceId,null);}
  assert.equal(deviceChecks,0); assert.equal(plants.get(b).deviceId,hardware);
});
test("failure after auto-unpair rolls back both plants and sanitizes storage errors", async () => {
  const before = structuredClone(histories);
  failUpdate = true;
  const response = await request({deviceId:hardware}); assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{error:"Internal server error.",code:"INTERNAL_ERROR"});
  assert.equal(plants.get(b).deviceId,hardware); assert.equal(plants.get(a).deviceId,null);
  assert.deepEqual(histories,before);
});
test("serialization conflicts retry fresh ownership checks; exhaustion is a controlled 409", async () => {
  conflictCount = 2;
  assert.equal((await request({deviceId:hardware})).status,200); assert.equal(attempts,3); assert.equal(deviceChecks,3); assert.equal(plants.get(b).deviceId,null);
  plants.set(a,row(a)); plants.set(b,row(b,owner,hardware)); attempts = 0; conflictCount = 3;
  const response = await request({deviceId:hardware}); assert.equal(response.status,409); assert.equal((await response.json()).code,"PAIRING_CONFLICT"); assert.equal(attempts,3);
  assert.equal(plants.get(b).deviceId,hardware); assert.equal(plants.get(a).deviceId,null);
});
test("concurrent requests are retried after commit conflict and retain only one holder", async () => {
  let release; const ready = new Promise(resolve => {release = resolve;});
  concurrencyGate = {arrivals:0,ready,release};
  const responses = await Promise.all([request({deviceId:hardware}),request({deviceId:hardware},b)]);
  assert.deepEqual(responses.map(res => res.status),[200,200]); assert.ok(attempts >= 3);
  assert.equal([...plants.values()].filter(plant => plant.deviceId === hardware).length,1);
});
test("ownership is rechecked inside the transaction when plant disappears", async () => {
  vanish = true; const response = await request({deviceId:hardware}); assert.equal(response.status,404); assert.equal((await response.json()).code,"NOT_FOUND");
  assert.equal(deviceChecks,0); assert.equal(plants.get(b).deviceId,hardware);
});

test("re-pairing the current device and repeated unpairing preserve session identity", async () => {
  const original = structuredClone(histories);
  for (let i=0;i<2;i++) assert.equal((await request({deviceId:hardware},b)).status,200);
  assert.deepEqual(histories,original);
  assert.equal((await request({deviceId:null},b)).status,200);
  const closed = structuredClone(histories);
  assert.equal((await request({deviceId:null},b)).status,200);
  assert.deepEqual(histories,closed);
});

test("legacy pointers start a new session now without inventing past ownership", async () => {
  histories = [];
  const start = Date.now();
  assert.equal((await request({deviceId:hardware},b)).status,200);
  assert.equal(histories.length,1);
  assert.equal(histories[0].plantId,b);
  assert.ok(histories[0].pairedAt.getTime() >= start && histories[0].pairedAt.getTime() <= Date.now());
});

test("transition time cannot precede an affected open start or closed boundary", async () => {
  const future = new Date(Date.now()+60000);
  histories[0].pairedAt = future;
  const boundary = new Date(future.getTime()+1000);
  histories.push({id:randomUUID(),plantId:a,deviceId:previous,pairedAt:future,unpairedAt:boundary});
  assert.equal((await request({deviceId:hardware})).status,200);
  const current = histories.find(row => row.unpairedAt === null);
  assert.equal(current.pairedAt.getTime(),boundary.getTime());
  assert.equal(histories[0].unpairedAt.getTime(),boundary.getTime());
});

test("native pairing uniqueness races retry without leaving tentative sessions behind", async () => {
  conflictError = Object.assign(new Error("concurrent open-session insert"),{code:"P2002",meta:{modelName:"DevicePairingHistory",target:["deviceId"]}});
  conflictCount = 1;
  assert.equal((await request({deviceId:hardware})).status,200);
  assert.equal(attempts,2); assert.equal(histories.length,2);
  assert.equal(histories.filter(row => row.unpairedAt === null).length,1);
});

test("unrelated uniqueness failures are not retried as pairing conflicts", async () => {
  conflictError = Object.assign(new Error("unrelated constraint failure"),{code:"P2002",meta:{modelName:"CareTask",target:["id"]}});
  conflictCount = 1;
  const before = structuredClone(histories);
  assert.equal((await request({deviceId:hardware})).status,500);
  assert.equal(attempts,1); assert.deepEqual(histories,before);
});
