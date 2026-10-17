import express from "express";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, mock, test } from "node:test";

const actorId = randomUUID();
let server, base, provisions, settings, audits, actorRole, actorActive, imageReads, providerCalls;
const copy = value => structuredClone(value);
const now = () => new Date("2026-10-17T08:00:00.000Z");
const pg = {
  user: { findUnique: async () => ({id:actorId,role:actorRole,isActive:actorActive}) },
  device: { findUnique: async () => null, findMany: async () => [] },
  deviceProvision: {
    findUnique: async ({where}) => copy([...provisions.values()].find(row => where.id ? row.id === where.id : row.macAddress === where.macAddress) ?? null),
    findUniqueOrThrow: async ({where}) => copy(provisions.get(where.id)),
    findMany: async query => copy([...provisions.values()].filter(row => !query.where.status || row.status === query.where.status).slice(query.skip,query.skip+query.take)),
    count: async query => [...provisions.values()].filter(row => !query.where.status || row.status === query.where.status).length,
    create: async ({data}) => {
      const row = {id:randomUUID(),label:null,claimedDeviceId:null,createdById:null,createdAt:now(),updatedAt:now(),...data};
      provisions.set(row.id,row); return copy(row);
    },
    updateMany: async ({where,data}) => {
      const row = provisions.get(where.id);
      if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) return {count:0};
      Object.assign(row,data); return {count:1};
    },
  },
  platformSettings: {
    findUnique: async () => copy(settings),
    findUniqueOrThrow: async () => copy({...settings,updatedBy:{id:actorId,email:"admin@test.invalid",name:"Admin"}}),
    upsert: async () => {
      settings ??= {id:"platform",aiScanningEnabled:true,deviceClaimsEnabled:true,updatedAt:now(),updatedById:null,updatedBy:null};
      return copy(settings);
    },
    updateMany: async ({where,data}) => {
      if (!settings || settings.updatedAt.getTime() !== where.updatedAt.getTime()) return {count:0};
      Object.assign(settings,data); return {count:1};
    },
  },
  auditLog: { create: async ({data}) => {audits.push(data); return {id:randomUUID(),...data};} },
  aIAnalysis: { findMany: async () => [] },
};
pg.$transaction = async operation => {
  const previous = copy({settings,audits,provisions:[...provisions]});
  try {return await operation(pg);}
  catch (error) {settings=previous.settings;audits=previous.audits;provisions=new Map(previous.provisions);throw error;}
};

before(async () => {
  mock.module(new URL("../src/lib/prisma-pg.js",import.meta.url).href,{namedExports:{prismaPg:pg}});
  mock.module(new URL("../src/lib/prisma.js",import.meta.url).href,{namedExports:{prisma:{}}});
  mock.module(new URL("../src/lib/admin-verification.js",import.meta.url).href,{namedExports:{
    securityTransaction: operation => pg.$transaction(operation), assertAdminVerification: async () => {},
  }});
  mock.module(new URL("../src/lib/auth.js",import.meta.url).href,{namedExports:{requireAuth:(req,res,next) => {
    res.locals.auth = {user:{id:actorId,role:req.get("x-role") ?? "ADMIN"},sessionId:"verified-session"};next();
  }}});
  mock.module(new URL("../src/lib/previous-scan-image.js",import.meta.url).href,{namedExports:{previousScanImage:async () => {imageReads++;throw new Error("must not fetch image");}}});
  mock.module(new URL("../src/lib/plantnet.js",import.meta.url).href,{namedExports:{identifyPlant:async () => {providerCalls++;throw new Error("must not call provider");}}});
  mock.module(new URL("../src/lib/gemini.js",import.meta.url).href,{namedExports:{
    geminiModel:() => {providerCalls++;throw new Error("must not call provider");}, geminiError: error => error,
  }});
  const app = express();app.use(express.json());
  app.use((req,res,next) => {res.locals.auth={user:{id:actorId,role:req.get("x-role") ?? "ADMIN"},sessionId:"verified-session"};next();});
  app.use("/api/admin",(await import("../src/routes/admin-platform.ts")).adminPlatformRouter);
  app.use("/api/scan",(await import("../src/routes/scan.ts")).scanRouter);
  app.use("/api/ai",(await import("../src/routes/ai.ts")).aiRouter);
  app.use((await import("../src/lib/http.ts")).errorHandler);
  server=app.listen(0,"127.0.0.1");await new Promise(resolve => server.once("listening",resolve));
  base=`http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {provisions=new Map();settings=null;audits=[];actorRole="ADMIN";actorActive=true;imageReads=0;providerCalls=0;});
after(async () => {if(server) await new Promise(resolve => server.close(resolve));mock.restoreAll();});
async function request(path,{method="GET",body,role="ADMIN"}={}) {
  const response=await fetch(base+path,{method,headers:{"Content-Type":"application/json","x-role":role},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
}
const register = (macAddress="lc-a50528") => request("/api/admin/devices/whitelist",{method:"POST",body:{macAddress,label:"Lab sensor",reason:"Approved lab hardware"}});

test("ADMIN provisions normalized hardware before claim and audit stores only approved metadata",async () => {
  const created=await register();assert.equal(created.status,201);
  assert.equal(created.body.data.macAddress,"LC-A50528");assert.equal(created.body.data.state,"APPROVED_UNCLAIMED");
  assert.equal(created.body.meta.schemaVersion,1);assert.equal(audits.length,1);
  assert.equal(audits[0].actorId,actorId);assert.equal(audits[0].targetId,created.body.data.id);
  assert.equal(audits[0].metadata.reason,"Approved lab hardware");assert.equal(audits[0].metadata.before,null);
  assert.equal((await register()).status,409);assert.equal(provisions.size,1);
  const listed=await request("/api/admin/devices/whitelist");assert.equal(listed.status,200);
  assert.equal(listed.body.pagination.total,1);assert.equal(listed.body.data[0].id,created.body.data.id);
});

test("revocation preserves claimed device link and stale edits cannot reapprove hardware",async () => {
  const created=(await register()).body.data;
  provisions.get(created.id).claimedDeviceId=randomUUID();
  const path=`/api/admin/devices/whitelist/${created.id}`;
  const revoked=await request(path,{method:"PATCH",body:{updatedAt:created.updatedAt,status:"REVOKED",reason:"Device reported missing"}});
  assert.equal(revoked.status,200);assert.equal(revoked.body.data.state,"REVOKED");
  assert.equal(revoked.body.data.claimedDeviceId,provisions.get(created.id).claimedDeviceId);
  const stale=await request(path,{method:"PATCH",body:{updatedAt:created.updatedAt,status:"APPROVED",reason:"Stale approval attempt"}});
  assert.equal(stale.status,409);assert.equal(stale.body.code,"STALE_PROVISION");
  assert.equal(provisions.get(created.id).status,"REVOKED");assert.equal(audits.length,2);
  assert.equal(audits[1].metadata.before.status,"APPROVED");assert.equal(audits[1].metadata.after.status,"REVOKED");
});

test("LEAD_DEV and USER cannot read or modify platform controls or provider configuration",async () => {
  for (const role of ["LEAD_DEV","USER"]) for (const [path,method,body] of [
    ["/devices/whitelist","GET"], ["/devices/whitelist","POST",{macAddress:"LC-A50528",reason:"Test reason"}],
    [`/devices/whitelist/${randomUUID()}`,"PATCH",{updatedAt:now().toISOString(),status:"REVOKED",reason:"Test reason"}],
    ["/settings","GET"], ["/settings","PATCH",{updatedAt:now().toISOString(),aiScanningEnabled:false,reason:"Test reason"}], ["/integrations","GET"],
  ]) assert.equal((await request(`/api/admin${path}`,{method,body,role})).status,403,`${role} ${method} ${path}`);
  assert.equal(audits.length,0);assert.equal(provisions.size,0);assert.equal(settings,null);
});

test("platform mutation rechecks current actor after a demotion or deactivation",async () => {
  actorRole="LEAD_DEV";
  assert.equal((await register()).status,403);assert.equal(provisions.size,0);
  actorRole="ADMIN";actorActive=false;
  assert.equal((await register()).status,403);assert.equal(audits.length,0);
});

test("settings save is versioned and auditable; repeated GET preserves the version",async () => {
  const initial=await request("/api/admin/settings");assert.equal(initial.status,200);
  assert.equal((await request("/api/admin/settings")).body.data.updatedAt,initial.body.data.updatedAt);
  const changed=await request("/api/admin/settings",{method:"PATCH",body:{updatedAt:initial.body.data.updatedAt,aiScanningEnabled:false,deviceClaimsEnabled:false,reason:"Maintenance window"}});
  assert.equal(changed.status,200);assert.equal(changed.body.data.aiScanningEnabled,false);assert.equal(changed.body.data.deviceClaimsEnabled,false);
  assert.equal(audits[0].metadata.before.aiScanningEnabled,true);assert.equal(audits[0].metadata.after.aiScanningEnabled,false);
  const stale=await request("/api/admin/settings",{method:"PATCH",body:{updatedAt:initial.body.data.updatedAt,aiScanningEnabled:true,reason:"Stale save attempt"}});
  assert.equal(stale.status,409);assert.equal(stale.body.code,"STALE_SETTINGS");assert.equal(audits.length,1);
});

test("disabled scanning blocks both analysis entry points before validation, image reads, and provider calls",async () => {
  settings={id:"platform",aiScanningEnabled:false,deviceClaimsEnabled:true,updatedAt:now()};
  for(const path of ["/api/scan","/api/ai/analyze"]) {
    const response=await request(path,{method:"POST",body:{unexpected:"input",reusePreviousImage:true}});
    assert.equal(response.status,503);assert.equal(response.body.code,"AI_SCANNING_DISABLED");
  }
  assert.equal(imageReads,0);assert.equal(providerCalls,0);
  assert.equal((await request("/api/scan/archives")).status,200);
});

test("monitor separates key configuration from verified health without probing or fabricated quota",async () => {
  const keys=["GEMINI_API_KEY","PLANTNET_API_KEY","PERENUAL_API_KEY"];
  const previous=Object.fromEntries(keys.map(key => [key,process.env[key]]));
  try {
    for(const key of keys) process.env[key]="private-provider-secret";
    const observed=await request("/api/admin/integrations");assert.equal(observed.status,200);assert.equal(observed.body.data.length,3);
    for(const row of observed.body.data) {
      assert.equal(row.configured,true);assert.equal(row.status,"UNVERIFIED");assert.equal(row.quota.remaining,null);
      assert.equal(row.quota.source,"unavailable");assert.equal(row.lastObservedAt,null);assert.equal(row.observedRequests,null);
    }
    assert.doesNotMatch(JSON.stringify(observed.body),/private-provider-secret/);assert.equal(providerCalls,0);
    for(const key of keys) delete process.env[key];
    assert.ok((await request("/api/admin/integrations")).body.data.every(row => row.status === "NOT_CONFIGURED"));
  } finally {for(const key of keys) if(previous[key]===undefined) delete process.env[key];else process.env[key]=previous[key];}
});

test("invalid settings and provisioning requests fail without writes",async () => {
  for(const [path,method,body] of [
    ["/devices/whitelist","POST",{macAddress:"bad",reason:"Hardware approval"}],
    ["/devices/whitelist","POST",{macAddress:"LC-A50528"}],
    ["/devices/whitelist","POST",{macAddress:"LC-A50528",reason:"Approved hardware",userId:actorId}],
    ["/settings","PATCH",{updatedAt:now().toISOString(),aiScanningEnabled:"false",reason:"Invalid flag"}],
    ["/settings","PATCH",{deviceClaimsEnabled:false,reason:"Missing version"}],
    ["/settings?extra=1","GET"], ["/settings?extra=1&extra=2","GET"], ["/integrations?probe=true","GET"],
    ["/devices/whitelist?status=INVALID","GET"], ["/devices/whitelist?page=1&page=2","GET"],
  ]) assert.equal((await request(`/api/admin${path}`,{method,body})).status,400,`${method} ${path}`);
  assert.equal(audits.length,0);assert.equal(provisions.size,0);
});

test("physical-device backfill is idempotent, records system audit, and preserves existing revocations",async () => {
  const {backfillDeviceProvisions}=await import("../scripts/backfill-device-provisions.mjs");
  const devices=[{id:randomUUID(),macAddress:"LC-000001",name:"Legacy sensor"},{id:randomUUID(),macAddress:"LC-000002",name:"Revoked sensor"}];
  const revoked=await pg.deviceProvision.create({data:{macAddress:devices[1].macAddress,status:"REVOKED",claimedDeviceId:devices[1].id}});
  const original=pg.device.findMany;pg.device.findMany=async () => devices;
  try {
    const dry=await backfillDeviceProvisions(pg);assert.equal(dry.created,1);assert.equal(provisions.size,1);assert.equal(audits.length,0);
    const applied=await backfillDeviceProvisions(pg,{apply:true});assert.equal(applied.created,1);assert.equal(applied.revokedPreserved,1);
    assert.equal(audits.length,1);assert.equal(audits[0].actorId,null);assert.equal(audits[0].metadata.actorId,"system:admin_features_v2");
    const repeated=await backfillDeviceProvisions(pg,{apply:true});assert.equal(repeated.created,0);assert.equal(repeated.unchanged,1);
    assert.equal(audits.length,1);assert.equal(provisions.get(revoked.id).status,"REVOKED");
  } finally {pg.device.findMany=original;}
});
