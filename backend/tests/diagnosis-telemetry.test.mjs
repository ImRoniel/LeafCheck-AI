import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnosisTelemetrySnapshot, readingIsFresh } from "../src/lib/diagnosis-telemetry.ts";
const now = Date.parse("2026-10-12T08:40:00Z");
test("freshness uses exact thirty-minute and future-clock boundaries", () => {
  for (const [age, fresh] of [[0,true],[30*60000,true],[30*60000+1,false],[-60000,true],[-60001,false]]) {
    assert.equal(readingIsFresh(new Date(now-age).toISOString(), now), fresh);
  }
  assert.equal(readingIsFresh("invalid", now), false);
});
test("historical snapshots normalize physical raw ADC/light and retain demo provenance independently of pairing", () => {
  const base = { deviceId: "LC-A50528", timestamp: new Date(now).toISOString(), temperature: 27, humidity: 60, soilMoisture: 2662, lightLux: 0.83 };
  const physical = diagnosisTelemetrySnapshot(base);
  assert.equal(physical.simulated, false); assert.equal(physical.soilMoisture, null); assert.equal(physical.soilMoistureRaw, 2662);
  assert.equal(physical.source, "legacy"); assert.equal(physical.plantId, undefined); assert.equal(physical.pairingId, undefined);
  const demo = diagnosisTelemetrySnapshot({ ...base, deviceId: "historical-demo", soilMoisture: 50, lightLux: null, lightLevel: 1000 }, "historical-demo");
  assert.equal(demo.simulated, true); assert.equal(demo.soilMoisture, 50); assert.equal(demo.lightLux, 1000);
  assert.equal(diagnosisTelemetrySnapshot(null), null);
});

const measurement = { deviceId: "LC-A50528", timestamp: new Date(now).toISOString(),
  temperature: 27, humidity: 60, soilMoisture: null, soilMoistureRaw: 2662, lightLux: 0.83 };
const provenance = { readingId: "0123456789abcdef01234567", plantId: "11111111-1111-4111-8111-111111111111",
  pairingId: "22222222-2222-4222-8222-222222222222", contextVersion: 1 };

test("Phase D: normalization accepts none and null without inventing measurements", () => {
  assert.deepEqual(diagnosisTelemetrySnapshot({source: "none"}), {source: "none"});
  assert.equal(diagnosisTelemetrySnapshot(null), null);
  assert.equal(diagnosisTelemetrySnapshot(undefined), null);
});

for (const source of ["current_session", "historical_session"]) test(`Phase D: normalization retains complete ${source} provenance`, () => {
  const value = {...measurement, ...provenance, source, simulated: false};
  assert.deepEqual(diagnosisTelemetrySnapshot(value), value);
});

test("Phase D: normalization rejects contradictory attribution and never fills it from the current plant", () => {
  for (const value of [
    {...measurement, pairingId: provenance.pairingId},
    {...measurement, plantId: provenance.plantId},
    {...measurement, source: "current_session"},
    {...measurement, ...provenance, plantId: undefined, source: "current_session"},
    {...measurement, ...provenance, pairingId: undefined, source: "historical_session"},
    {...measurement, ...provenance, contextVersion: 2, source: "current_session"},
    {...measurement, ...provenance, source: "legacy"},
    {...measurement, ...provenance, readingId: "invalid", source: "current_session"},
    {...measurement, ...provenance, plantId: "invalid", source: "current_session"},
    {...measurement, source: "unknown"}, {...measurement, source: null},
    {...measurement, source: "none"}, {source: "none", pairingId: provenance.pairingId},
  ]) assert.equal(diagnosisTelemetrySnapshot(value, provenance.plantId), null);
  const legacy = diagnosisTelemetrySnapshot(measurement, provenance.plantId);
  assert.equal(legacy.source, "legacy"); assert.equal(legacy.plantId, undefined); assert.equal(legacy.pairingId, undefined);
});
