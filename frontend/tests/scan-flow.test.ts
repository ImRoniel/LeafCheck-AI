import assert from "node:assert/strict";
import test from "node:test";
import { createScanFlow } from "../services/scan-flow";
import type { Plant, ScanResponse } from "../types";
const report: ScanResponse = {
  success: true,
  plant: { id: "p", name: "Fern", species: "Fern" },
  identification: { speciesName: "Fern", commonName: null, confidence: 1 },
  diagnostic: {
    id: "a",
    healthStatus: "healthy",
    rawAnalysisText: "report",
    telemetryFreshness: "fresh",
  },
  telemetry: null,
  careTasks: [],
  notification: null,
};
const plant:Plant={id:"p",name:"Fern",species:"Fern",healthStatus:"healthy",createdAt:"2026-09-19T10:00:00Z",updatedAt:"2026-09-19T10:00:00Z"};
test("patch failure retains report and retry only synchronizes",async()=>{
  let scans=0,patches=0;
  const flow=createScanFlow({scanPlant:async()=>{scans++;return report;},updatePlantHealth:async()=>{if(++patches === 1) throw new Error("offline");return {id:"p",healthStatus:"healthy"};},fetchPlant:async()=>plant});
  await assert.rejects(flow.scan({plantId:"p",imageBase64:"abc"}));assert.equal(flow.getState().report,report);assert.ok(flow.getState().synchronizationError);
  await assert.rejects(flow.scan({plantId:"p",imageBase64:"abc"}));
  await flow.retrySynchronization();assert.equal(scans,1);assert.equal(patches,2);assert.equal(flow.getState().phase,"complete");
});
test("refetch retry skips a completed patch and guards duplicate scans",async()=>{
  let scans=0,patches=0,gets=0;
  const flow=createScanFlow({scanPlant:async()=>{scans++;return report;},updatePlantHealth:async()=>{patches++;return {id:"p",healthStatus:"healthy"};},fetchPlant:async()=>{if(++gets===1) throw new Error("offline");return plant;}});
  const pending=flow.scan({plantId:"p",imageBase64:"abc"});await assert.rejects(flow.scan({plantId:"p",imageBase64:"abc"}));await assert.rejects(pending);
  await flow.retrySynchronization();assert.equal(scans,1);assert.equal(patches,1);assert.equal(gets,2);
});
test("cancelled scan suppresses late completion and never patches",async()=>{
  let resolve!:(value:ScanResponse)=>void;let patches=0;
  const flow=createScanFlow({scanPlant:()=>new Promise(done=>{resolve=done;}),updatePlantHealth:async()=>{patches++;return {id:"p",healthStatus:"healthy"};},fetchPlant:async()=>plant});
  const pending=flow.scan({plantId:"p",imageBase64:"abc"});flow.cancel();resolve(report);await assert.rejects(pending);assert.equal(patches,0);assert.equal(flow.getState().report,null);
});
