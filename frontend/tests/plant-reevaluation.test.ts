import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createApiClient } from "../services/api";
import type { ArchiveEntry, ScanResponse } from "../types";
import { elements, press, profileHarness, plantId, accountId, testPlant } from "./helpers/plant-telemetry-harness";

const deviceId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-10-12T00:00:00Z", readingAt = "2026-10-12T01:00:00Z";
const latest: ArchiveEntry = { id: "old", plantId, userId: accountId, healthStatus: "healthy",
  rawAnalysisText: "No device associated with this plant", speciesName: "Fern", notificationTime: null,
  notificationReason: null, createdAt, plant: { id: plantId, name: "Fern", species: "Fern" } };
const report: ScanResponse = { success: true, plant: latest.plant,
  identification: { speciesName: "Fern", commonName: null, confidence: 1 },
  diagnostic: { id: "new", healthStatus: "warning", rawAnalysisText: "Light is low. Move to indirect light.", telemetryFreshness: "FRESH", createdAt: "2026-10-12T02:00:00Z" },
  telemetry: { temperature: 32, humidity: 76, soilMoisture: null, soilMoistureRaw: 2625, lightLevel: 0.83, timestamp: readingAt },
  careTasks: [], notification: null };
const setup = () => {
  const flow = profileHarness(async () => ({ paired: true,
    device: { id: deviceId, name: "Sensor", macAddress: "LC-A50528", status: "ONLINE", createdAt, updatedAt: createdAt, userId: accountId },
    telemetry: { deviceId, timestamp: readingAt, soilMoisture: { percentage: null, rawAnalogValue: 2625, status: "unavailable" }, lightLevel: { lux: 0.83, status: "insufficient" }, environment: { temperatureCelsius: 32, humidityPercentage: 76 } },
  }));
  flow.metadata({ plants: [{ ...testPlant, deviceId, imageUrl: "data:image/jpeg;base64,/9j/2Q==" }] });
  flow.guidance(latest);
  return flow;
};
test("re-evaluation stays on the profile, prevents duplicate requests and replaces the diagnosis and timestamp", async () => {
  const flow = setup();
  let resolve!: (report: ScanResponse) => void;
  let requests = 0;
  flow.scan(async request => {
    requests++;
    assert.deepEqual(JSON.parse(JSON.stringify(request)), { plantId, reusePreviousImage: true });
    return new Promise(done => { resolve = done; });
  });
  flow.render(); await nextTurn();
  press(flow.render(), "Re-evaluate with Sensor Data");
  assert.match(JSON.stringify(flow.render()), /Re-evaluating\.\.\./);
  const card = elements(flow.render()).find(node => node.type === "PlantDiagnosisCard");
  (card?.props.onReevaluate as (() => void) | undefined)?.();
  assert.equal(requests, 1);
  resolve(report); await nextTurn();
  const updated = elements(flow.render()).find(node => node.type === "PlantDiagnosisCard");
  assert.equal((updated?.props.latest as ArchiveEntry).id, "new");
  assert.equal((updated?.props.latest as ArchiveEntry).createdAt, report.diagnostic.createdAt);
  assert.match(JSON.stringify(updated), /Light is low/);
  assert.doesNotMatch(JSON.stringify(updated), /No device associated|Re-evaluating/);
  assert.equal(flow.guidanceRefreshes(), 1);
  assert.equal(flow.collectionReads(), 1);
  assert.deepEqual(flow.navigations, []);
  flow.dispose();
});
test("failed re-evaluation retains the old report and allows retry", async () => {
  const flow = setup(); flow.scan(async () => { throw new Error("AI unavailable"); });
  flow.render(); await nextTurn(); press(flow.render(), "Re-evaluate with Sensor Data"); await nextTurn();
  const node = flow.render();
  assert.match(JSON.stringify(node), /Re-evaluation failed/);
  assert.match(JSON.stringify(node), /No device associated/);
  assert.match(JSON.stringify(node), /Re-evaluate with Sensor Data/);
  flow.dispose();
});
test("button requires a paired device, saved image, previous diagnosis and newer telemetry", async () => {
  const flow = setup(); flow.render(); await nextTurn();
  flow.metadata({ plants: [{ ...testPlant, deviceId: undefined, imageUrl: "saved" }] });
  assert.match(JSON.stringify(flow.render()), /Re-evaluate with Sensor Data/);
  flow.metadata({ plants: [{ ...testPlant, deviceId, imageUrl: undefined }] });
  const unavailable = flow.render();
  assert.equal(elements(unavailable).find(node => node.props.label === "Re-evaluate with Sensor Data")?.props.disabled, true);
  assert.match(JSON.stringify(unavailable), /No saved photo is available/);
  flow.metadata({ plants: [{ ...testPlant, deviceId, imageUrl: "saved" }] });
  flow.guidance({ ...latest, createdAt: readingAt });
  assert.doesNotMatch(JSON.stringify(flow.render()), /Re-evaluate with Sensor Data/);
  flow.guidance(null);
  assert.doesNotMatch(JSON.stringify(flow.render()), /Re-evaluate with Sensor Data/);
  flow.dispose();
});
test("route exit aborts re-evaluation and ignores its late response", async () => {
  const flow = setup(); let signal: AbortSignal | undefined; let resolve!: (report: ScanResponse) => void;
  flow.scan(async (_request, options) => { signal = options?.signal; return new Promise(done => { resolve = done; }); });
  flow.render(); await nextTurn(); press(flow.render(), "Re-evaluate with Sensor Data");
  flow.dispose(); assert.equal(signal?.aborted, true);
  resolve(report); await nextTurn();
  assert.equal(flow.guidanceRefreshes(), 0);
});
test("API accepts saved-photo scans without an upload and rejects missing plant IDs", async () => {
  const client = createApiClient({ baseUrl: "https://example.test", fetch: async (_url, options) => {
    assert.deepEqual(JSON.parse(String(options?.body)), { plantId, reusePreviousImage: true });
    return new Response(JSON.stringify(report));
  } });
  assert.equal((await client.scanPlant({ plantId, reusePreviousImage: true })).diagnostic.id, "new");
  assert.throws(() => client.scanPlant({ reusePreviousImage: true }));
  assert.throws(() => client.scanPlant({ plantId }));
});
