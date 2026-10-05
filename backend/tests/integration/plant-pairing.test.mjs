import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import { PrismaClient } from "../../src/generated/postgres-client/index.js";

// This test only runs against the disposable runner's localhost database.
const url = new URL(process.env.POSTGRES_URL ?? "http://invalid");
if (!/^leafcheck-pairing-test-[\da-f-]+$/.test(process.env.LEAFCHECK_SCAN_TEST_CONTAINER ?? "") || url.hostname !== "127.0.0.1" || url.pathname !== "/leafcheck_pairing_test") throw new Error("Use the disposable pairing runner, not an application database.");
const client = new PrismaClient({datasources:{db:{url:url.href}}, log:[]});
mock.module(new URL("../../src/lib/prisma-pg.js",import.meta.url).href,{namedExports:{prismaPg:client}});
const {pairPlantDevice} = await import("../../src/lib/plant-pairing.ts");
const userId = randomUUID(), foreignId = randomUUID();
let a,b,device;
before(async () => {
  await client.user.createMany({data:[{id:userId,email:`${userId}@test.invalid`,password:"unused"},{id:foreignId,email:`${foreignId}@test.invalid`,password:"unused"}]});
  device = await client.device.create({data:{name:"Test",macAddress:"LC-ABC123",userId}});
  a = await client.plant.create({data:{name:"A",species:"Fern",userId}});
  b = await client.plant.create({data:{name:"B",species:"Fern",userId}});
});
after(async () => {mock.restoreAll(); await client.$disconnect();});
test("actual PostgreSQL concurrent pairings to distinct targets retain one holder", async () => {
  let transactions = 0, arrivals = 0, release;
  const ready = new Promise(resolve => {release = resolve;});
  const concurrent = {$transaction(operation,options) {
    transactions++;
    assert.equal(options.isolationLevel,"Serializable");
    return client.$transaction(async tx => operation(new Proxy(tx, {get(target,key) {
      if(key !== "plant") return Reflect.get(target,key);
      return new Proxy(target.plant,{get(delegate,method) {
        const value = Reflect.get(delegate,method);
        if(method !== "updateMany") return typeof value === "function" ? value.bind(delegate) : value;
        return async (...args) => {
          // Ownership reads establish both snapshots before either transaction writes.
          if(arrivals < 2) {arrivals++; if(arrivals === 2) release(); await ready;}
          return value.apply(delegate,args);
        };
      }});
    }})),options);
  }};
  const results = await Promise.all([pairPlantDevice(a.id,userId,device.id,concurrent),pairPlantDevice(b.id,userId,device.id,concurrent)]);
  assert.equal(results.length,2); assert.ok(transactions >= 3,"expected an actual serialization retry");
  const holders = await client.plant.findMany({where:{deviceId:device.id}});
  assert.equal(holders.length,1); assert.ok([a.id,b.id].includes(holders[0].id));
});
test("actual PostgreSQL failure after unpair rolls back the previous association", async () => {
  await pairPlantDevice(b.id,userId,device.id);
  const failing = {$transaction(operation,options) {return client.$transaction(tx => operation(new Proxy(tx,{get(target,key) {
    if(key !== "plant") return Reflect.get(target,key);
    return new Proxy(target.plant,{get(delegate,method) {
      const value = Reflect.get(delegate,method);
      if(method === "update") return async () => {throw new Error("injected assignment failure");};
      return typeof value === "function" ? value.bind(delegate) : value;
    }});
  }})),options);}};
  await assert.rejects(pairPlantDevice(a.id,userId,device.id,failing),/injected assignment failure/);
  assert.equal((await client.plant.findUnique({where:{id:b.id}})).deviceId,device.id);
  assert.equal((await client.plant.findUnique({where:{id:a.id}})).deviceId,null);
});
test("actual PostgreSQL ownership failures do not mutate associations; unpair repeats", async () => {
  await assert.rejects(pairPlantDevice(a.id,foreignId,device.id),{code:"NOT_FOUND"});
  const foreign = await client.device.create({data:{name:"Foreign",macAddress:"LC-ABC124",userId:foreignId}});
  await assert.rejects(pairPlantDevice(a.id,userId,foreign.id),{code:"NOT_FOUND"});
  assert.equal((await client.plant.findUnique({where:{id:b.id}})).deviceId,device.id);
  await pairPlantDevice(b.id,userId,null); await pairPlantDevice(b.id,userId,null);
  assert.equal(await client.plant.count({where:{deviceId:device.id}}),0);
});
