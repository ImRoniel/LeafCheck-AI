import assert from "node:assert/strict";
import test from "node:test";
import { createScanFlow } from "../services/scan-flow";
import type { Plant, ScanResponse } from "../types";
import { deferred } from "./helpers/scanner-harness";
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

test("a scan for the wrong plant is rejected before any state mutation", async () => {
  let patches = 0;
  const flow = createScanFlow({
    scanPlant: async () => ({ ...report, plant: { ...report.plant, id: "other" } }),
    updatePlantHealth: async () => { patches++; return { id: "p", healthStatus: "healthy" }; },
    fetchPlant: async () => plant,
  });
  await assert.rejects(flow.scan({ plantId: "p", imageBase64: "abc" }), /does not match/);
  assert.equal(patches, 0);
  assert.equal(flow.getState().report, null);
});

test("a mismatched refreshed plant never enters the completed scan state", async () => {
  const flow = createScanFlow({
    scanPlant: async () => report,
    updatePlantHealth: async () => ({ id: "p", healthStatus: "healthy" }),
    fetchPlant: async () => ({ ...plant, id: "other" }),
  });
  await assert.rejects(flow.scan({ plantId: "p", imageBase64: "abc" }), /does not match/);
  assert.equal(flow.getState().plant, null);
  assert.equal(flow.getState().phase, "error");
  assert.ok(flow.getState().synchronizationError);
});

test("endSession is idempotent and clears successful and failed flow snapshots", async () => {
  const flow = createScanFlow({ scanPlant: async () => report, updatePlantHealth: async () => ({ id: "p", healthStatus: "healthy" }), fetchPlant: async () => plant });
  for (let i = 0; i < 3; i++) {
    await flow.scan({ plantId: "p", imageBase64: "abc" });
    flow.endSession(); flow.endSession();
    assert.deepEqual(flow.getState(), { phase: "idle", report: null, plant: null, error: null, synchronizationError: null });
  }
  const failed = createScanFlow({ scanPlant: async () => { throw new Error("offline"); }, updatePlantHealth: async () => ({ id: "p", healthStatus: "healthy" }), fetchPlant: async () => plant });
  await assert.rejects(failed.scan({ imageBase64: "abc" }));
  failed.endSession();
  assert.equal(failed.getState().error, null);
  assert.equal(failed.getState().phase, "idle");
});

for (const stage of ["scan", "update", "fetch"] as const) {
  for (const outcome of ["resolve", "reject"] as const) {
    test(`closed ${stage} ${outcome} cannot alter or unlock a new pending scan`, async () => {
      const old = deferred<ScanResponse | Plant | { id: string; healthStatus: "healthy" }>();
      const next = deferred<ScanResponse>();
      const entered = deferred<void>();
      let scans = 0, patches = 0, fetches = 0;
      let signal: AbortSignal | undefined;
      const flow = createScanFlow({
        scanPlant: async (_request, options) => {
          if (++scans > 1) return next.promise;
          signal = options?.signal;
          if (stage === "scan") { entered.resolve(); return old.promise as Promise<ScanResponse>; }
          return report;
        },
        updatePlantHealth: async () => {
          patches++;
          if (stage === "update" && patches === 1) { entered.resolve(); return old.promise as Promise<{ id: string; healthStatus: "healthy" }>; }
          return { id: "p", healthStatus: "healthy" };
        },
        fetchPlant: async () => {
          fetches++;
          if (stage === "fetch" && fetches === 1) { entered.resolve(); return old.promise as Promise<Plant>; }
          return plant;
        },
      });
      const pending = assert.rejects(flow.scan({ plantId: "p", imageBase64: "old" }));
      await entered.promise;
      flow.endSession(); flow.endSession();
      assert.equal(signal?.aborted, true);
      assert.deepEqual(flow.getState(), { phase: "idle", report: null, plant: null, error: null, synchronizationError: null });
      const fresh = flow.scan({ plantId: "p", imageBase64: "new" });
      if (outcome === "reject") old.reject(new Error("late failure"));
      else old.resolve(stage === "scan" ? report : stage === "fetch" ? plant : { id: "p", healthStatus: "healthy" });
      await pending;
      assert.equal(flow.getState().phase, "scanning");
      assert.equal(flow.getState().report, null);
      assert.equal(fetches, stage === "fetch" ? 1 : 0);
      await assert.rejects(flow.scan({ imageBase64: "duplicate" }), /already running/);
      next.resolve(report); await fresh;
      assert.equal(flow.getState().phase, "complete");
      assert.equal(patches, stage === "scan" ? 1 : 2);
    });
  }
}
