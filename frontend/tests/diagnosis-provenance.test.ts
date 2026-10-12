import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { diagnosisBadgeLabel, telemetryIsFresh } from "../services/plant-profile-guidance";
import type { ArchiveEntry, DiagnosisTelemetrySnapshot, PlantTelemetry } from "../types";
import { elements, press, profileHarness, plantId, accountId, testPlant } from "./helpers/plant-telemetry-harness";
const deviceId = "22222222-2222-4222-8222-222222222222";
const now = Date.now();
const snapshot: DiagnosisTelemetrySnapshot = { deviceId: "LC-A50528", timestamp: new Date(now-60_000).toISOString(),
  capturedAt: new Date(now).toISOString(), temperature: 27, humidity: 60, soilMoisture: null, soilMoistureRaw: 2625, lightLux: 0.83, simulated: false };
const diagnosis: ArchiveEntry = { id: "analysis", plantId, userId: accountId, healthStatus: "healthy", rawAnalysisText: "A saved diagnosis.",
  speciesName: "Snake plant", notificationTime: null, notificationReason: null, createdAt: new Date(now).toISOString(), plant: null };
const payload = (timestamp: string): PlantTelemetry => ({ paired: true,
  device: { id: deviceId, userId: accountId, name: "Sensor", macAddress: "LC-A50528", status: "ONLINE", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() },
  telemetry: { deviceId, timestamp, environment: { temperatureCelsius: 27, humidityPercentage: 60 }, soilMoisture: { percentage: null, rawAnalogValue: 2625, status: "unavailable" }, lightLevel: { lux: 0.83, status: "insufficient" } } });

test("badge reflects all four saved input contexts at capture time, independent of today's clock", () => {
  assert.equal(diagnosisBadgeLabel(null, diagnosis.createdAt), "Image-Only AI");
  assert.equal(diagnosisBadgeLabel(snapshot, "2027-01-01T00:00:00Z"), "Sensor-Enhanced AI");
  assert.equal(diagnosisBadgeLabel({ ...snapshot, timestamp: new Date(now-31*60_000).toISOString() }, diagnosis.createdAt), "Image + Older Sensor Readings");
  assert.equal(diagnosisBadgeLabel({ ...snapshot, simulated: true }, diagnosis.createdAt), "Demo-Assisted AI");
  assert.equal(diagnosisBadgeLabel({ ...snapshot, deviceId, simulated: undefined }, diagnosis.createdAt), "Image-Only AI");
  for (const [age,fresh] of [[0,true],[30*60_000,true],[30*60_000+1,false],[-60_000,true],[-60_001,false]] as const) assert.equal(telemetryIsFresh(new Date(now-age).toISOString(), now), fresh);
});

test("pairing a sensor cannot relabel the Snake Plant's successful image-only diagnosis", async t => {
  const flow = profileHarness(async () => payload(new Date(now-15*60*60_000).toISOString())); t.after(flow.dispose);
  flow.metadata({ plants: [{ ...testPlant, deviceId, imageUrl: "saved" }] });
  flow.guidance({ ...diagnosis, rawAnalysisText: "No ideal species specifications or measured environmental conditions are available.", telemetrySnapshot: null });
  flow.render(); await nextTurn();
  const card = elements(flow.render()).find(node => node.type === "PlantDiagnosisCard")!;
  assert.match(JSON.stringify(card), /Image-Only AI/); assert.doesNotMatch(JSON.stringify(card), /Sensor-Enhanced AI/);
  assert.doesNotMatch(JSON.stringify(card), /Retry AI Diagnosis|Re-evaluate with Sensor Data/);
});

test("new readings arriving before report completion still enable re-evaluation, while stale readings do not", async t => {
  const flow = profileHarness(async () => payload(new Date(now-30_000).toISOString())); t.after(flow.dispose);
  flow.metadata({ plants: [{ ...testPlant, deviceId, imageUrl: "saved" }] });
  flow.guidance({ ...diagnosis, telemetrySnapshot: snapshot });
  flow.render(); await nextTurn();
  // Current reading precedes diagnosis.createdAt but follows the input snapshot.
  assert.match(JSON.stringify(flow.render()), /Re-evaluate with Sensor Data/);
  flow.guidance({ ...diagnosis, telemetrySnapshot: { ...snapshot, timestamp: new Date(now).toISOString() } });
  assert.doesNotMatch(JSON.stringify(flow.render()), /Re-evaluate with Sensor Data/);
  const stale = profileHarness(async () => payload(new Date(now-31*60_000).toISOString())); t.after(stale.dispose);
  stale.metadata({ plants: [{ ...testPlant, deviceId, imageUrl: "saved" }] });
  stale.guidance({ ...diagnosis, telemetrySnapshot: { ...snapshot, timestamp: new Date(now-60*60_000).toISOString() } });
  stale.render(); await nextTurn();
  assert.doesNotMatch(JSON.stringify(stale.render()), /Re-evaluate with Sensor Data/);
});

test("focused profile polls for new sensor readings and reveals re-evaluation without a full rescan", async t => {
  const callbacks: (() => void)[] = [];
  t.mock.method(globalThis, "setInterval", ((callback: () => void) => {
    callbacks.push(callback); return { unref() {} };
  }) as unknown as typeof setInterval);
  t.mock.method(globalThis, "clearInterval", () => {});
  let time = snapshot.timestamp, requests = 0;
  const flow = profileHarness(async () => { requests++; return payload(time); }); t.after(flow.dispose);
  flow.metadata({ plants: [{ ...testPlant, deviceId, imageUrl: "saved" }] }); flow.guidance({ ...diagnosis, telemetrySnapshot: snapshot });
  flow.render(); await nextTurn(); assert.doesNotMatch(JSON.stringify(flow.render()), /Re-evaluate with Sensor Data/);
  time = new Date(now-10_000).toISOString(); callbacks[0](); await nextTurn();
  assert.equal(requests, 2); assert.match(JSON.stringify(flow.render()), /Re-evaluate with Sensor Data/);
  flow.dispose(); callbacks[0](); await nextTurn(); assert.equal(requests, 2);
});
