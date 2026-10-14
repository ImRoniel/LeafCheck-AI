import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { createApiClient, type PlantHistoryQuery } from "../services/api";
import type { PollingOptions } from "../services/use-polling-resource";
import type { TelemetryHistory } from "../types";

const plantId = "11111111-1111-4111-8111-111111111111";
const response: TelemetryHistory = {data:[{id:"reading",deviceId:"original-device",timestamp:"2026-10-01T00:00:00Z",temperature:25,humidity:60,soilMoisture:null,soilMoistureRaw:2024,lightLevel:1200}],pagination:{total:1,limit:50,offset:0,hasMore:false}};

test("plant history uses the plant endpoint and normalizes encoded ISO date bounds",async () => {
  const api = createApiClient({baseUrl:"https://example.test",fetch:async url => {
    const target = new URL(String(url));
    assert.equal(target.pathname,`/api/plants/${plantId}/telemetry/history`);
    assert.equal(target.searchParams.get("limit"),"50"); assert.equal(target.searchParams.get("offset"),"0");
    assert.equal(target.searchParams.get("from"),"2026-10-01T00:00:00.000Z");
    assert.equal(target.searchParams.get("to"),"2026-10-02T00:00:00.000Z");
    return Response.json(response);
  }});
  assert.deepEqual(await api.fetchPlantTelemetryHistory(plantId,{from:"2026-10-01T08:00:00+08:00",to:"2026-10-02"}),response);
});

test("invalid plant identifiers, pagination and date ranges fail before network requests",() => {
  let requests=0;
  const api=createApiClient({baseUrl:"https://example.test",fetch:async () => {requests++; return Response.json(response);}});
  assert.throws(() => api.fetchPlantTelemetryHistory("bad-id"));
  for(const query of [{limit:0},{limit:201},{offset:-1},{offset:2147483648},{from:"bad"},{from:"2026-02-30"},{from:"2026-10-02",to:"2026-10-01"}]) {
    assert.throws(() => api.fetchPlantTelemetryHistory(plantId,query));
  }
  assert.equal(requests,0);
});

test("history hook polls by plant and date/page scope without requiring a device",async () => {
  const requested:string[]=[];
  const api=createApiClient({baseUrl:"https://example.test",fetch:async url => {requested.push(String(url)); return Response.json(response);}});
  const calls: {key:string;load:(signal:AbortSignal) => Promise<TelemetryHistory>;options:PollingOptions}[]=[];
  const exports:Record<string,unknown>={};
  const source=readFileSync(new URL("../hooks/use-telemetry-history.ts",import.meta.url),"utf8");
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require(name:string) {
    if(name === "../services/api") return {fetchPlantTelemetryHistory:api.fetchPlantTelemetryHistory};
    if(name === "../services/use-polling-resource") return {usePollingResource(key:string,load:(signal:AbortSignal) => Promise<TelemetryHistory>,options:PollingOptions) {
      calls.push({key,load,options}); return {data:null,loading:false,error:null,refresh:() => load(new AbortController().signal)};
    }};
    throw new Error(`Unexpected hook import: ${name}`);
  }});
  const hook=exports.useTelemetryHistory as (id:string|null,query?:PlantHistoryQuery,options?:PollingOptions) => {readings:unknown[]};
  assert.deepEqual(Array.from(hook(plantId).readings),[]);
  await calls[0].load(new AbortController().signal);
  assert.match(requested[0],new RegExp(`/api/plants/${plantId}/telemetry/history`));
  hook(plantId,{offset:50,from:"2026-10-01",to:"2026-10-02"});
  assert.notEqual(calls[0].key,calls[1].key);
  assert.deepEqual(JSON.parse(calls[1].key),[plantId,50,50,"2026-10-01","2026-10-02"]);
  hook(null); assert.equal(calls[2].key,"");
});
