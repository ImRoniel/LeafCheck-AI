import assert from "node:assert/strict";
import test from "node:test";
import { dashboardSensors, summarizeDashboard, sensorStatusLabel, readingTimeLabel } from "../services/dashboard-summary";
import type { Plant } from "../types/plant";
import type { PlantTelemetry } from "../types/device";
import type { GardenCareTask } from "../types/care-task";
import type { ArchiveEntry } from "../types/scan";

const now = new Date(2026, 9, 12, 12);
const plant: Plant = { id: "p1", deviceId: "device-uuid", name: "Fern", species: "Fern", healthStatus: "unknown", createdAt: now.toISOString(), updatedAt: now.toISOString() };
function reading(timestamp: string | null = now.toISOString(), macAddress = "LC-A50528"): PlantTelemetry {
  return { paired: true, device: { id: plant.deviceId!, userId: "owner", name: "Window sensor", macAddress, status: "OFFLINE", createdAt: now.toISOString(), updatedAt: now.toISOString() }, telemetry: timestamp === null ? null : {
    deviceId: plant.deviceId!, timestamp, environment: { temperatureCelsius: 25, humidityPercentage: 60 },
    soilMoisture: { rawAnalogValue: 2652, percentage: null, status: "unavailable" }, lightLevel: { lux: 1200, status: "optimal" },
  } };
}
function sensor(payload = reading(), failed = false, source = plant) {
  return dashboardSensors([source], [{ plantId: source.id, payload, failed }], now)[0];
}
function task(plantId: string, dueAt: string | null, priority: GardenCareTask["priority"] = "routine"): GardenCareTask {
  return { id: `${plantId}:${dueAt}`, key: plantId, plantId, dueAt, priority, title: "Check soil moisture", details: "Check soil before watering." };
}
function archive(plantId: string, createdAt = now.toISOString()): ArchiveEntry {
  return { id: Math.random().toString(), plantId, createdAt, userId: "owner", healthStatus: "unknown", rawAnalysisText: null, speciesName: null, notificationTime: null, notificationReason: null, plant: null };
}
test("physical LC-A50528 is receiving despite a stale Device status; raw ADC never implies watering", () => {
  const item = sensor();
  assert.equal(item.status, "receiving"); assert.equal(item.demo, false);
  assert.equal(item.address, "LC-A50528"); assert.equal(item.timestamp, now.toISOString());
  assert.equal(sensorStatusLabel(item.status), "Receiving readings");
  const summary = summarizeDashboard([plant], [], [], now);
  assert.equal(summary.attention.length, 0);
  assert.equal(summary.highlights[0].reason, "Not assessed yet");
});
test("pairing alone, missing payload, unpaired payload and errors have separate non-live states", () => {
  assert.equal(sensor(reading(null)).status, "waiting");
  assert.equal(dashboardSensors([plant], [], now)[0].status, "checking");
  assert.equal(sensor({ paired: false, device: null, telemetry: null }).status, "unpaired");
  assert.equal(sensor(reading(), true).status, "error");
  assert.equal(dashboardSensors([plant], [], now, true)[0].status, "error");
  assert.deepEqual(dashboardSensors([{ ...plant, deviceId: undefined }], [], now), []);
});
test("stale, invalid, excessive future timestamps and exact freshness boundaries", () => {
  for (const timestamp of ["invalid", new Date(now.getTime() - 30 * 60_000 - 1).toISOString(), new Date(now.getTime() + 60_001).toISOString()]) assert.equal(sensor(reading(timestamp)).status, "stale");
  assert.equal(sensor(reading(new Date(now.getTime() - 30 * 60_000).toISOString())).status, "receiving");
  assert.equal(readingTimeLabel(new Date(now.getTime() - 120_000).toISOString(), now), "Updated 2 min ago");
  assert.equal(readingTimeLabel("invalid", now), "");
});
test("demo evidence from either server plant or device address never counts as physical live", () => {
  assert.equal(sensor(reading(), false, { ...plant, simulated: true }).status, "demo");
  assert.equal(sensor(reading(now.toISOString(), "DEMO:p1")).status, "demo");
  const demo = { ...plant, id: "p2", simulated: true };
  const mixed = dashboardSensors([plant, demo], [{ plantId: plant.id, payload: reading(), failed: false }, { plantId: demo.id, payload: reading(), failed: false }], now);
  assert.deepEqual(mixed.map(item => item.status), ["receiving", "demo"]);
});
test("a response for an old device cannot label a newly paired sensor live", () => {
  assert.equal(sensor(reading(), false, { ...plant, deviceId: "replacement" }).status, "checking");
});
test("attention ranks saved critical/warning ahead of tasks, deduplicates plants and caps previews", () => {
  const plants = [plant, { ...plant, id: "critical", healthStatus: "critical" as const }, { ...plant, id: "warning", healthStatus: "warning" as const }, { ...plant, id: "late" }];
  const summary = summarizeDashboard(plants, [task("late", new Date(now.getTime() - 60_000).toISOString()), task("late", now.toISOString())], [], now);
  assert.equal(summary.attention.length, 2);
  assert.deepEqual(summary.highlights.map(item => item.plant.id), ["critical", "warning", "late"]);
  assert.match(summary.highlights[0].reason, /saved critical/);
  assert.equal(summary.dueToday, 2);
  assert.equal(summary.overdue, 1);
});
test("today excludes undated, other-day and foreign tasks; future urgent care is not due now", () => {
  const tomorrow = new Date(2026, 9, 13).toISOString();
  const summary = summarizeDashboard([plant], [task(plant.id, null), task(plant.id, tomorrow, "immediate"), task("foreign", now.toISOString())], [], now);
  assert.equal(summary.attention.length, 0); assert.equal(summary.dueToday, 0);
});
test("daily scan digest counts distinct owned plants on local calendar boundaries", () => {
  const yesterday = new Date(2026, 9, 11, 23, 59).toISOString();
  const tomorrow = new Date(2026, 9, 13).toISOString();
  const summary = summarizeDashboard([plant], [], [archive(plant.id), archive(plant.id), archive("foreign"), archive(plant.id, yesterday), archive(plant.id, tomorrow)], now);
  assert.equal(summary.scannedToday, 1); assert.equal(summary.scansLimited, false);
});
test("capped scan history indicates a lower bound only when today's coverage may be incomplete", () => {
  const archives = Array.from({ length: 50 }, () => archive(plant.id));
  assert.equal(summarizeDashboard([plant], [], archives, now, true).scansLimited, true);
  archives[49] = archive(plant.id, new Date(2026, 9, 11).toISOString());
  const summary = summarizeDashboard([plant], [], archives, now, true);
  assert.equal(summary.scansLimited, false); assert.equal(summary.tasksLimited, true);
});
