import express from "express";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";

const plantId = randomUUID(), deviceId = randomUUID();
let server, base, plant, device, readings, queries, deviceQueries, failPlant, failDevice, failMongo;
const now = new Date("2026-10-05T00:00:00.000Z");
const sample = (extra = {}) => ({deviceId:"LC-A50528",timestamp:now,soilMoisture:50,soilMoistureRaw:2024,lightLevel:1200,temperature:25.5,humidity:61,...extra});
before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href,{namedExports:{requireAuth(req,res,next) {
    const user = req.get("authorization"); if (!user) return res.status(401).json({code:"UNAUTHORIZED"});
    res.locals.auth={user:{id:user}}; next();
  }}});
  mock.module(new URL("../src/lib/prisma-pg.js",import.meta.url).href,{namedExports:{prismaPg:{
    plant:{findFirst:async ({where}) => {if(failPlant) throw new Error("private pg credentials"); return where.id === plant?.id && where.userId === plant.userId ? {...plant} : null;}},
    device:{findFirst:async ({where}) => {deviceQueries++; if(failDevice) throw new Error("private device failure"); return where.id === device?.id && where.userId === device.userId ? {...device} : null;}},
  }}});
  mock.module(new URL("../src/lib/prisma.js",import.meta.url).href,{namedExports:{prisma:{sensorReading:{findFirst:async query => {
    queries.push(query); if(failMongo) throw new Error("private mongo credentials");
    assert.deepEqual(query.orderBy,{timestamp:"desc"});
    return readings.filter(row => row.deviceId === query.where.deviceId).sort((a,b) => b.timestamp-a.timestamp)[0] ?? null;
  }}}}});
  mock.module(new URL("../src/lib/demo-telemetry.js",import.meta.url).href,{namedExports:{demoDeviceId:id => `demo-${id}`,seedDemoTelemetry:async () => {throw new Error("unexpected demo call");}}});
  const {plantsRouter} = await import("../src/routes/plants.ts"); const {errorHandler}=await import("../src/lib/http.ts");
  const app=express(); app.use(express.json()); app.use("/api/plants",plantsRouter); app.use(errorHandler);
  server=app.listen(0,"127.0.0.1"); await new Promise(resolve => server.once("listening",resolve)); base=`http://127.0.0.1:${server.address().port}/api/plants`;
});
beforeEach(() => {
  plant={id:plantId,userId:"owner",deviceId,minMoisture:40,maxMoisture:60};
  device={id:deviceId,userId:"owner",name:"Window",macAddress:"LC-A50528",status:"OFFLINE",createdAt:now,updatedAt:now,internal:"omit"};
  readings=[sample()]; queries=[]; deviceQueries=0; failPlant=failDevice=failMongo=false;
});
after(async () => {if(server) await new Promise(resolve => server.close(resolve)); mock.restoreAll();});
const request=(id=plantId,user="owner") => fetch(`${base}/${id}/telemetry`,{headers:user ? {Authorization:user} : {}});
test("unpaired plant returns explicit empty state without device or Mongo queries",async () => {
  plant.deviceId=null; const response=await request(); assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{paired:false,device:null,telemetry:null}); assert.equal(queries.length,0); assert.equal(deviceQueries,0);
});
test("paired plant joins hardware MAC and returns newest reading in the canonical payload",async () => {
  readings.push(sample({timestamp:new Date(now.getTime()-1000),soilMoisture:1}));
  readings.push(sample({deviceId:"LC-000001",timestamp:new Date(now.getTime()+1000),soilMoisture:99}));
  const response=await request(); assert.equal(response.status,200); const body=await response.json();
  assert.deepEqual(queries,[{where:{deviceId:"LC-A50528"},orderBy:{timestamp:"desc"}}]);
  assert.deepEqual(body,{paired:true,device:{id:deviceId,userId:"owner",name:"Window",macAddress:"LC-A50528",status:"OFFLINE",createdAt:now.toISOString(),updatedAt:now.toISOString()},telemetry:{
    deviceId:"LC-A50528",timestamp:now.toISOString(),soilMoisture:{percentage:50,rawAnalogValue:2024,status:"optimal"},lightLevel:{lux:1200,status:"optimal"},environment:{temperatureCelsius:25.5,humidityPercentage:61},
  }});
});
test("soil classification uses custom plant bounds including both inclusive boundaries",async () => {
  for(const [moisture,status] of [[39.99,"dry"],[40,"optimal"],[50,"optimal"],[60,"optimal"],[60.01,"overwatered"]]) {
    readings=[sample({soilMoisture:moisture})]; const response=await request(); assert.equal(response.status,200); assert.equal((await response.json()).telemetry.soilMoisture.status,status);
  }
});
test("nullable sensors retain zero fallback and light thresholds retain inclusive optimal boundaries",async () => {
  for(const [lightLevel,status] of [[null,"insufficient"],[0,"insufficient"],[499,"insufficient"],[500,"optimal"],[50000,"optimal"],[50001,"excessive"]]) {
    readings=[sample({lightLevel,soilMoistureRaw:null})]; const body=await (await request()).json();
    assert.equal(body.telemetry.lightLevel.lux,lightLevel ?? 0); assert.equal(body.telemetry.lightLevel.status,status); assert.equal(body.telemetry.soilMoisture.rawAnalogValue,0);
  }
});
test("no MAC reading returns paired device with null telemetry; UUID readings are not a fallback",async () => {
  for(const rows of [[],[sample({deviceId})]]) {
    readings=rows; const response=await request(); assert.equal(response.status,200); const body=await response.json();
    assert.equal(body.paired,true); assert.equal(body.device.id,deviceId); assert.equal(body.telemetry,null);
  }
});
test("unauthorized, invalid, absent and foreign resources stop before Mongo queries",async () => {
  assert.equal((await request(plantId,null)).status,401); assert.equal((await request("invalid")).status,400);
  for(const [id,user] of [[randomUUID(),"owner"],[plantId,"other"]]) {const response=await request(id,user); assert.equal(response.status,404); assert.equal((await response.json()).code,"NOT_FOUND");}
  assert.equal(deviceQueries,0); assert.equal(queries.length,0);
  device.userId="other"; let response=await request(); assert.equal(response.status,404); assert.equal((await response.json()).code,"NOT_FOUND");
  device=null; response=await request(); assert.equal(response.status,404); assert.equal(queries.length,0);
});
test("failures from either database are sanitized and do not leak storage details",async () => {
  for(const stage of ["plant","device","mongo"]) {
    failPlant=stage === "plant"; failDevice=stage === "device"; failMongo=stage === "mongo";
    const response=await request(); assert.equal(response.status,500); assert.deepEqual(await response.json(),{error:"Internal server error.",code:"INTERNAL_ERROR"});
  }
});
