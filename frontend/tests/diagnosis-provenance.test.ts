import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { diagnosisBadgeLabel, diagnosisBadgePresentation, telemetryIsFresh } from "../services/plant-profile-guidance";
import type { ArchiveEntry, DiagnosisMeasurementSnapshot, DiagnosisTelemetrySnapshot, PlantTelemetry } from "../types";
import { elements, press, profileHarness, plantId, accountId, testPlant } from "./helpers/plant-telemetry-harness";
const deviceId = "22222222-2222-4222-8222-222222222222";
const now = Date.now();
const snapshot: DiagnosisMeasurementSnapshot = { deviceId: "LC-A50528", timestamp: new Date(now-60_000).toISOString(),
  capturedAt: new Date(now).toISOString(), temperature: 27, humidity: 60, soilMoisture: null, soilMoistureRaw: 2625, lightLux: 0.83, simulated: false,
  readingId: "0123456789abcdef01234567", plantId, pairingId: deviceId, contextVersion: 1, source: "current_session" };
const diagnosis: ArchiveEntry = { id: "analysis", plantId, userId: accountId, healthStatus: "healthy", rawAnalysisText: "A saved diagnosis.",
  speciesName: "Snake plant", notificationTime: null, notificationReason: null, createdAt: new Date(now).toISOString(), plant: null };
const payload = (timestamp: string): PlantTelemetry => ({ paired: true,
  device: { id: deviceId, userId: accountId, name: "Sensor", macAddress: "LC-A50528", status: "ONLINE", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() },
  telemetry: { deviceId, timestamp, environment: { temperatureCelsius: 27, humidityPercentage: 60 }, soilMoisture: { percentage: null, rawAnalogValue: 2625, status: "unavailable" }, lightLevel: { lux: 0.83, status: "insufficient" } } });

test("badge reflects saved provenance independently of today's pairing and measurement age", () => {
  assert.equal(diagnosisBadgeLabel(null, diagnosis.createdAt), "Image-Only AI");
  assert.equal(diagnosisBadgeLabel(snapshot, "2027-01-01T00:00:00Z"), "Sensor-Enhanced AI");
  assert.equal(diagnosisBadgeLabel({ ...snapshot, timestamp: new Date(now-31*60_000).toISOString() }, diagnosis.createdAt), "Sensor-Enhanced AI");
  assert.equal(diagnosisBadgeLabel({ ...snapshot, simulated: true }, diagnosis.createdAt), "Sensor-Enhanced AI");
  assert.equal(diagnosisBadgeLabel({ ...snapshot, source: "historical_session" }, diagnosis.createdAt), "Image + Older Sensor Readings");
  assert.equal(diagnosisBadgeLabel({ ...snapshot, source: "legacy" }, diagnosis.createdAt), "Image-Only AI (legacy)");
  assert.equal(diagnosisBadgeLabel({ source: "none" }, diagnosis.createdAt), "Image-Only AI");
  assert.equal(diagnosisBadgeLabel({ deviceId, timestamp: snapshot.timestamp, temperature: 27, humidity: 60, soilMoisture: null, soilMoistureRaw: null, lightLux: null }), "Image-Only AI (legacy)");
  for (const [age,fresh] of [[0,true],[30*60_000,true],[30*60_000+1,false],[-60_000,true],[-60_001,false]] as const) assert.equal(telemetryIsFresh(new Date(now-age).toISOString(), now), fresh);
});

for (const [context, label, backgroundColor] of [
  [snapshot, "Sensor-Enhanced AI", "#E8F5E9"],
  [{source: "none"}, "Image-Only AI", "#EEF2F0"],
  [{...snapshot, source: "historical_session"}, "Image + Older Sensor Readings", "#FFF3D6"],
  [{...snapshot, source: "legacy"}, "Image-Only AI (legacy)", "#F1F1F1"],
  [null, "Image-Only AI", "#EEF2F0"],
] as const) test(`diagnosis card renders ${label} with its source-specific badge color`, async t => {
  const flow = profileHarness(async () => ({paired: false, device: null, telemetry: null})); t.after(flow.dispose);
  flow.guidance({...diagnosis, telemetrySnapshot: context as DiagnosisTelemetrySnapshot | null});
  flow.render(); await nextTurn();
  const card = elements(flow.render()).find(node => node.type === "PlantDiagnosisCard")!;
  const badge = elements(card.props.children).find(node => node.props.children === label)!;
  assert.equal((badge.props.style as {backgroundColor: string}).backgroundColor, backgroundColor);
  assert.equal(diagnosisBadgePresentation(context).label, label);
  if (!context || context.source === "none") assert.doesNotMatch(JSON.stringify(card), /Readings used|Invalid Date/);
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
