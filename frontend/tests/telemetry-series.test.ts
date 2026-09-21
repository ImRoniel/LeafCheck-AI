import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient } from "../services/api";
import {
    chronologicalReadings,
    metricSeries,
} from "../services/telemetry-series";

test("all 193 samples are chronological without mutating API order or losing null/zero light", () => {
  const readings = Array.from({ length: 193 }, (_, i) => ({
    id: String(i),
    deviceId: "demo",
    timestamp: new Date(1800000000000 - i * 900000).toISOString(),
    soilMoisture: 50,
    temperature: 25,
    humidity: 70,
    lightLevel: i === 0 ? null : 0,
    soilMoistureRaw: null,
  }));
  const ordered = chronologicalReadings(readings);
  assert.equal(ordered.length, 193);
  assert.equal(ordered[0].id, "192");
  assert.equal(readings[0].id, "0");
  for (const metric of [
    "soilMoisture",
    "temperature",
    "humidity",
    "lightLevel",
  ] as const)
    assert.equal(metricSeries(ordered, metric).length, 193);
  assert.equal(metricSeries(ordered, "lightLevel")[0].value, 0);
  assert.equal(metricSeries(ordered, "lightLevel")[192].value, null);
});
test("seed client posts and preserves server device linkage and simulation marker", async () => {
  const client = createApiClient({
    baseUrl: "https://example.test",
    fetch: async (url, options) => {
      assert.equal(url, "https://example.test/api/plants/plant/seed-telemetry");
      assert.equal(options?.method, "POST");
      return new Response(
        JSON.stringify({
          id: "plant",
          name: "Fern",
          species: "Fern",
          healthStatus: "unknown",
          deviceId: "demo",
          simulated: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      );
    },
  });
  const result = await client.seedTelemetry("plant");
  assert.equal(result.deviceId, "demo");
  assert.equal(result.simulated, true);
});
