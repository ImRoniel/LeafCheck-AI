import assert from "node:assert/strict";
import test from "node:test";
import { parseArchives, parseScan } from "../services/validators";
import { identificationConfidenceLabel } from "../services/plant-profile-guidance";
import type { ScanResponse } from "../types";
import { report as scannerReport, scannerHarness } from "./helpers/scanner-harness";

const plantId = "11111111-1111-4111-8111-111111111111";
const pairingId = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-10-14T09:00:00.000Z";
const measurements = {deviceId: "LC-A50528", timestamp, temperature: 27, humidity: 60,
  soilMoisture: null, soilMoistureRaw: 2500, lightLux: 100};
const attributed = {...measurements, readingId: "0123456789abcdef01234567", plantId, pairingId, contextVersion: 1, source: "current_session"};
const report: ScanResponse = {success: true, plant: {id: plantId, name: "Basil", species: "Ocimum basilicum"},
  identification: {speciesName: "Ocimum basilicum", commonName: "Basil", confidence: 0.989},
  diagnostic: {id: "analysis", healthStatus: "healthy", rawAnalysisText: "Healthy plant.", telemetryFreshness: "Fresh"},
  telemetry: null, careTasks: [], notification: null};
const archive = {id: "analysis", plantId, userId: "owner", healthStatus: "healthy", rawAnalysisText: "Healthy plant.",
  speciesName: "Ocimum basilicum", notificationTime: null, notificationReason: null, createdAt: timestamp, plant: report.plant};

test("validators accept legacy responses, old snapshots, explicit none, and attributed snapshots", () => {
  assert.deepEqual(parseScan(report), report);
  for (const snapshot of [undefined, null, measurements, {...measurements, source: "legacy"}, {source: "none"}, attributed, {...attributed, source: "historical_session"}]) {
    const value = {...report, telemetrySnapshot: snapshot, identificationReused: true};
    assert.deepEqual(parseScan(value), value);
    assert.deepEqual(parseArchives([{...archive, telemetrySnapshot: snapshot}]), [{...archive, telemetrySnapshot: snapshot}]);
  }
});

test("validators reject malformed or contradictory provenance in scans and archives", () => {
  for (const snapshot of [
    {...measurements, pairingId}, {...measurements, plantId},
    {...attributed, plantId: undefined}, {...attributed, pairingId: undefined},
    {...attributed, contextVersion: 2}, {...attributed, source: "legacy"},
    {...attributed, readingId: "invalid"}, {...attributed, pairingId: "invalid"},
    {...attributed, source: "unknown"}, {...attributed, source: "none"},
    {source: "none", pairingId}, {...measurements, source: "current_session"},
  ]) {
    assert.throws(() => parseScan({...report, telemetrySnapshot: snapshot}));
    assert.throws(() => parseArchives([{...archive, telemetrySnapshot: snapshot}]));
  }
  assert.throws(() => parseScan({...report, identificationReused: "true"}));
  assert.throws(() => parseScan({...report, identificationMessage: 42}));
});

test("confidence formatting distinguishes unavailable zero, reused zero, and genuine low confidence", () => {
  assert.equal(identificationConfidenceLabel(0), "N/A");
  assert.equal(identificationConfidenceLabel(0, true), "0.0%");
  assert.equal(identificationConfidenceLabel(0.00001), "0.001%");
  assert.equal(identificationConfidenceLabel(0.989, true), "98.9%");
});

for (const reused of [false, true]) test(`scanner displays ${reused ? "original confidence and the reuse note" : "N/A for unavailable confidence"}`, async t => {
  const h = scannerHarness(); t.after(h.unmount);
  h.behavior.scan = async () => ({...scannerReport, identification: {...scannerReport.identification!, confidence: reused ? 0.989 : 0},
    identificationReused: reused, telemetrySnapshot: {source: "none"}});
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, reused ? /Confidence: 98\.9%.*\(reused from original scan\)/ : /Confidence: N\/A/);
  if (!reused) assert.doesNotMatch(h.text, /0\.0%|reused from original scan/);
  assert.match(h.text, /Image-Only AI/);
});
