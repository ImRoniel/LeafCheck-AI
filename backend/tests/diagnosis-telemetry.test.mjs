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
  const demo = diagnosisTelemetrySnapshot({ ...base, deviceId: "historical-demo", soilMoisture: 50, lightLux: null, lightLevel: 1000 }, "historical-demo");
  assert.equal(demo.simulated, true); assert.equal(demo.soilMoisture, 50); assert.equal(demo.lightLux, 1000);
  assert.equal(diagnosisTelemetrySnapshot(null), null);
});
