import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createApiClient } from "../services/api";
import { ApiError } from "../services/errors";
import type { ArchiveEntry, ScanResponse } from "../types";
import { elements, press, profileHarness, plantId, accountId, testPlant } from "./helpers/plant-telemetry-harness";

const deviceId = "22222222-2222-4222-8222-222222222222";
const createdAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString(), readingAt = new Date().toISOString();
const latest: ArchiveEntry = { id: "old", plantId, userId: accountId, healthStatus: "healthy",
  rawAnalysisText: "No device associated with this plant", speciesName: "Fern", notificationTime: null,
  notificationReason: null, createdAt, plant: { id: plantId, name: "Fern", species: "Fern" } };
const report: ScanResponse = { success: true, plant: latest.plant,
  identification: { speciesName: "Fern", commonName: null, confidence: 0.989 }, identificationReused: true,
  diagnostic: { id: "new", healthStatus: "warning", rawAnalysisText: "Light is low. Move to indirect light.", telemetryFreshness: "FRESH", createdAt: new Date(Date.now() + 1000).toISOString() },
  telemetrySnapshot: { deviceId: "LC-A50528", temperature: 32, humidity: 76, soilMoisture: null, soilMoistureRaw: 2625, lightLux: 0.83, timestamp: readingAt, simulated: false,
    readingId: "0123456789abcdef01234567", plantId, pairingId: deviceId, contextVersion: 1, source: "current_session" },
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
  assert.match(JSON.stringify(updated), /98\.9%/);
  assert.match(JSON.stringify(updated), /\(reused from original scan\)/);
  assert.doesNotMatch(JSON.stringify(updated), /No device associated|Re-evaluating/);
  assert.equal(flow.guidanceRefreshes(), 1);
  assert.equal(flow.collectionReads(), 1);
  assert.deepEqual(flow.navigations, []);
  flow.dispose();
});

for (const confidence of [0, 0.00001]) test(`profile displays genuine confidence ${confidence} without a false reuse label`, async t => {
  const flow = setup(); t.after(flow.dispose);
  flow.scan(async () => ({...report, identification: {...report.identification!, confidence}, identificationReused: false,
    identificationMessage: confidence === 0 ? "Previous identification confidence is unavailable." : undefined}));
  flow.render(); await nextTurn(); press(flow.render(), "Re-evaluate with Sensor Data"); await nextTurn();
  const card = elements(flow.render()).find(node => node.type === "PlantDiagnosisCard")!;
  assert.match(JSON.stringify(card), confidence === 0 ? /N\/A/ : /0\.001%/);
  assert.doesNotMatch(JSON.stringify(card.props.children), /reused from original scan|0\.0%/);
});

test("profile does not attach live confidence to a different archived diagnosis", async t => {
  const flow = setup(); t.after(flow.dispose); flow.scan(async () => report);
  flow.render(); await nextTurn(); press(flow.render(), "Re-evaluate with Sensor Data"); await nextTurn();
  flow.guidance({...latest, id: "newer-archive", createdAt: new Date(Date.now()+10_000).toISOString()});
  const card = elements(flow.render()).find(node => node.type === "PlantDiagnosisCard")!;
  assert.equal((card.props.latest as ArchiveEntry).id, "newer-archive");
  assert.doesNotMatch(JSON.stringify(card.props.children), /98\.9%|reused from original scan/);
});
test("failed re-evaluation retains the old report and allows retry", async () => {
  const flow = setup(); flow.scan(async () => { throw new Error("AI unavailable"); });
  flow.render(); await nextTurn(); press(flow.render(), "Re-evaluate with Sensor Data"); await nextTurn();
  const node = flow.render();
  assert.match(JSON.stringify(node), /AI diagnosis could not be generated/);
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
  flow.guidance({ ...latest, telemetrySnapshot: report.telemetrySnapshot });
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

for (const paired of [false, true]) {
  test(`missing diagnosis retries the saved photo with ${paired ? "sensor enhancement" : "image-only context"}, without needing newer telemetry`, async () => {
    const flow = paired ? setup() : profileHarness(async () => ({ paired: false, device: null, telemetry: null }));
    flow.metadata({ plants: [{ ...testPlant, ...(paired ? { deviceId } : {}), imageUrl: "data:image/jpeg;base64,/9j/2Q==" }] });
    flow.guidance({ ...latest, rawAnalysisText: null, diagnosisError: true, createdAt: readingAt, telemetrySnapshot: paired ? report.telemetrySnapshot : null });
    let resolve!: (report: ScanResponse) => void;
    let scans = 0;
    flow.scan(async request => {
      scans++;
      assert.deepEqual(JSON.parse(JSON.stringify(request)), { plantId, reusePreviousImage: true });
      return new Promise(done => { resolve = done; });
    });
    flow.render(); await nextTurn();
    const before = flow.render();
    assert.match(JSON.stringify(before), /Scan saved\. AI diagnosis failed\. Retry to generate the diagnosis\./);
    assert.doesNotMatch(JSON.stringify(before), /Retry saved guidance|Re-evaluate with Sensor Data/);
    const retryRow = elements(before).find(node => elements(node.props.children).some(child => child.props.label === "Retry AI Diagnosis") && node.type === "View");
    assert.match(JSON.stringify(retryRow), new RegExp(paired ? "Sensor-Enhanced AI" : "Image-Only AI"));
    press(before, "Retry AI Diagnosis");
    assert.match(JSON.stringify(flow.render()), /Retrying\.\.\./);
    assert.equal(elements(flow.render()).find(node => node.props.label === "Retrying...")?.props.disabled, true);
    const card = elements(flow.render()).find(node => node.type === "PlantDiagnosisCard");
    (card?.props.onRetry as () => void)(); assert.equal(scans, 1);
    resolve({ ...report, diagnosisError: false, telemetry: paired ? report.telemetry : null }); await nextTurn();
    const updated = elements(flow.render()).find(node => node.type === "PlantDiagnosisCard");
    assert.equal((updated?.props.latest as ArchiveEntry).diagnosisError, false);
    assert.match(JSON.stringify(updated), /Light is low/);
    assert.doesNotMatch(JSON.stringify(updated), /AI diagnosis failed|Retrying/);
    assert.equal(flow.collectionReads(), 1); assert.equal(flow.guidanceRefreshes(), 1);
    assert.deepEqual(flow.navigations, []);
    flow.dispose();
  });
}

test("a photo with no archive can generate diagnosis, and repeated quota failures leave a usable retry button", async () => {
  const flow = setup(); flow.guidance(null);
  flow.scan(async () => ({ ...report, diagnosisError: true, diagnosisCode: "SCAN_AI_BUSY", diagnosisMessage: "The AI service is busy. Please try again in a few minutes.", diagnostic: { ...report.diagnostic, rawAnalysisText: null }, careTasks: [], notification: null }));
  flow.render(); await nextTurn();
  press(flow.render(), "Retry AI Diagnosis"); await nextTurn();
  assert.match(JSON.stringify(flow.render()), /AI service is busy\. Please try again in a few minutes/);
  assert.match(JSON.stringify(flow.render()), /Retry AI Diagnosis/);
  flow.scan(async () => { throw new ApiError("http", "raw private provider response", 503, { code: "SCAN_AI_BUSY" }); });
  press(flow.render(), "Retry AI Diagnosis"); await nextTurn();
  assert.match(JSON.stringify(flow.render()), /AI service is busy/);
  assert.doesNotMatch(JSON.stringify(flow.render()), /raw private/);
  flow.dispose();
});

test("retry diagnosis is available without sensors or a previous successful report, and stops on route exit", async () => {
  const flow = profileHarness(async () => ({ paired: false, device: null, telemetry: null }));
  flow.metadata({ plants: [{ ...testPlant, imageUrl: "saved" }] });
  let signal: AbortSignal | undefined, resolve!: (report: ScanResponse) => void;
  flow.scan(async (_request, options) => { signal = options?.signal; return new Promise(done => { resolve = done; }); });
  flow.render(); await nextTurn(); press(flow.render(), "Retry AI Diagnosis");
  flow.dispose(); assert.equal(signal?.aborted, true);
  resolve(report); await nextTurn();
  assert.equal(flow.guidanceRefreshes(), 0); assert.equal(flow.collectionReads(), 0);
});

test("scan API accepts saved incomplete diagnoses and rejects inconsistent failure payloads", async () => {
  const incomplete = { ...report, diagnosisError: true, diagnosisMessage: "Scan saved. AI diagnosis failed. Retry to generate the diagnosis.", diagnosisCode: "SCAN_AI_BUSY", diagnostic: { ...report.diagnostic, rawAnalysisText: null, healthStatus: "unknown" }, careTasks: [], notification: null };
  const api = createApiClient({ fetch: async () => Response.json(incomplete) });
  assert.equal((await api.scanPlant({ plantId, reusePreviousImage: true })).diagnosisError, true);
  for (const invalid of [{ ...incomplete, diagnosisError: false }, { ...incomplete, diagnosisMessage: undefined },
    { ...incomplete, notification: { notifyAt: readingAt, reason: "invented reminder" } },
    { ...incomplete, diagnostic: { ...incomplete.diagnostic, rawAnalysisText: "pretend diagnosis" } }]) {
    const bad = createApiClient({ fetch: async () => Response.json(invalid) });
    await assert.rejects(bad.scanPlant({ plantId, reusePreviousImage: true }), (error: unknown) => error instanceof ApiError && error.kind === "validation");
  }
});
