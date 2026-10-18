import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactNode } from "react";
import { loadComponent } from "./startup-test-helpers";
import { createApiClient } from "../services/api";
import {
    chronologicalReadings,
    metricSeries,
} from "../services/telemetry-series";

test("hardware history uses the paired device UUID and parses all 66 normalized readings", async () => {
  const deviceId = "00000000-0000-4000-8000-000000000002";
  const data = Array.from({ length: 66 }, (_, index) => ({
    id: String(index), deviceId,
    timestamp: new Date(1800000000000 - index * 60000).toISOString(),
    temperature: 25, humidity: 50, soilMoisture: null,
    soilMoistureRaw: 2652, lightLevel: 10.83,
  }));
  const client = createApiClient({
    baseUrl: "https://example.test",
    fetch: async (url) => {
      assert.equal(url, `https://example.test/api/telemetry/${deviceId}/history?limit=200&offset=0`);
      return new Response(JSON.stringify({
        data, pagination: { total: 66, limit: 200, offset: 0, hasMore: false },
      }));
    },
  });
  const history = await client.fetchTelemetryHistory(deviceId, { limit: 200, offset: 0 });
  assert.deepEqual(history.data, data);
  assert.equal(history.pagination.total, 66);
  const ordered = chronologicalReadings(history.data);
  assert.equal(ordered[0].id, "65");
  assert.equal(metricSeries(ordered, "lightLevel")[0].value, 10.83);
  assert.equal(metricSeries(ordered, "soilMoistureRaw")[0].value, 2652);
});

test("raw soil series keeps zero ADC and separates calibrated percentages from raw readings", () => {
  const base = { id: "raw", deviceId: "sensor", timestamp: "2026-10-18T00:00:00Z", temperature: 25, humidity: 50, lightLevel: null };
  const readings = [
    { ...base, soilMoisture: null, soilMoistureRaw: 0 },
    { ...base, id: "percentage", soilMoisture: 0, soilMoistureRaw: 2000 },
    { ...base, id: "missing", soilMoisture: null, soilMoistureRaw: null },
  ];
  assert.deepEqual(metricSeries(readings, "soilMoistureRaw").map(point => point.value), [0, null, null]);
  assert.deepEqual(metricSeries(readings, "soilMoisture").map(point => point.value), [null, 0, null]);
});

test("history renders physical moisture as ADC without mixing it into a percentage chart", () => {
  const readings = [{ id: "raw", deviceId: "sensor", timestamp: "2026-10-18T00:00:00Z", temperature: 25,
    humidity: 50, lightLevel: null, soilMoisture: null as number | null, soilMoistureRaw: 2652 }];
  const History = loadComponent<(props: { plantId: string }) => ReactNode>("components/telemetry-history.tsx", {
    react: { useState: () => [0, () => {}] },
    "react-native": { ScrollView: "ScrollView", Text: "Text", View: "View" },
    "./screen": { Action: "Action", Notice: "Notice", ui: {} },
    "@/services/telemetry-series": { chronologicalReadings, metricSeries },
    "@/hooks/use-telemetry-history": { useTelemetryHistory: () => ({ readings, loading: false, error: null, refreshData: async () => {} }) },
  }, [], {}, "TelemetryHistory");
  const physical = JSON.stringify(History({ plantId: "plant" }));
  assert.match(physical, /2652 ADC/);
  assert.doesNotMatch(physical, /2652 %/);
  assert.match(physical, /Moisture · Raw ADC/);
  readings.push({ ...readings[0], id: "calibrated", soilMoisture: 50, soilMoistureRaw: 2000 });
  const mixed = JSON.stringify(History({ plantId: "plant" }));
  assert.match(mixed, /50 %/); assert.match(mixed, /2652 ADC/);
  assert.doesNotMatch(mixed, /2000 ADC/);
});

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
