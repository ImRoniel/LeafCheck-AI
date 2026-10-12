import assert from "node:assert/strict";
import test from "node:test";
import { groupSensorOverview } from "../services/sensor-overview";
import type { SensorOverviewEntry } from "../types/device";

const now = new Date("2026-10-12T08:00:00Z");
function sensor(id: string, plantId = id, options: Partial<SensorOverviewEntry> = {}): SensorOverviewEntry {
  return {
    device: { id, name: `Sensor ${id}`, macAddress: `LC-${id}`, userId: "owner", status: "OFFLINE", createdAt: now.toISOString(), updatedAt: now.toISOString() },
    plants: [{ id: plantId, name: `Plant ${plantId}` }], demo: false, readingError: false,
    telemetry: { deviceId: id, timestamp: now.toISOString(), environment: { temperatureCelsius: 25, humidityPercentage: 55 },
      soilMoisture: { percentage: null, rawAnalogValue: 2400, status: "unavailable" }, lightLevel: { lux: 600, status: "optimal" } },
    ...options,
  };
}

test("sensor groups prioritize errors, delayed and missing readings before healthy and demo devices", () => {
  const healthy = sensor("healthy"), delayed = sensor("delayed"), failed = sensor("failed", "failed", { readingError: true });
  delayed.telemetry!.timestamp = new Date(now.getTime() - 31 * 60_000).toISOString();
  const entries = [healthy, sensor("demo", "demo", { demo: true }), delayed, sensor("waiting", "waiting", { telemetry: null }), failed];
  const original = [...entries];
  const groups = groupSensorOverview(entries, "", now);
  assert.deepEqual(groups.map(group => group.status), ["error", "stale", "waiting", "receiving", "demo"]);
  assert.deepEqual(groups.map(group => group.attentionCount), [1, 1, 1, 0, 0]);
  assert.deepEqual(entries, original);
});

test("multiple sensors share one plant heading and their readings are prioritized within it", () => {
  const entries = [sensor("healthy", "fern"), sensor("failed", "fern", { readingError: true }), sensor("waiting", "fern", { telemetry: null })];
  const groups = groupSensorOverview(entries, "", now);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "Plant fern");
  assert.equal(groups[0].attentionCount, 2);
  assert.deepEqual(groups[0].entries.map(entry => entry.device.id), ["failed", "waiting", "healthy"]);
});

test("sensor search matches device IDs and every linked plant name, ignoring case and outside whitespace", () => {
  const shared = sensor("A50528", "fern", { plants: [{ id: "fern", name: "Fern" }, { id: "monstera", name: "Monstera" }] });
  const entries = [shared, sensor("000001", "jade")];
  for (const query of ["  lc-a50528  ", "MONSTERA", "fern"]) {
    assert.deepEqual(groupSensorOverview(entries, query, now).flatMap(group => group.entries), [shared]);
  }
  assert.deepEqual(groupSensorOverview(entries, "not present", now), []);
  assert.equal(groupSensorOverview(entries, "   ", now).length, 2);
});

test("shared devices are not duplicated, identical plant names stay distinct, and unlinked devices group together", () => {
  const plants = [{ id: "a", name: "Fern" }, { id: "b", name: "Monstera" }];
  const entries = [sensor("first", "", { plants }), sensor("second", "", { plants: [...plants].reverse() }),
    sensor("unlinked-a", "", { plants: [] }), sensor("unlinked-b", "", { plants: [] }),
    sensor("different-fern", "", { plants: [{ id: "c", name: "Fern" }] })];
  const groups = groupSensorOverview(entries, "", now);
  assert.equal(groups.length, 3);
  assert.equal(groups.find(group => group.title === "Unlinked devices")!.entries.length, 2);
  assert.equal(groups.find(group => group.title === "Fern · Monstera")!.entries.length, 2);
  assert.equal(new Set(groups.flatMap(group => group.entries.map(entry => entry.device.id))).size, entries.length);
  assert.deepEqual(entries[1].plants, [...plants].reverse());
});

test("twenty sensors stay in five plant groups and filtering never loses or duplicates inventory", () => {
  const entries = Array.from({ length: 20 }, (_, index) => sensor(String(index).padStart(6, "0"), `group-${index % 5}`));
  const groups = groupSensorOverview(entries, "", now);
  assert.equal(groups.length, 5);
  assert.ok(groups.every(group => group.entries.length === 4));
  assert.equal(groups.flatMap(group => group.entries).length, 20);
  assert.equal(groupSensorOverview(entries, "group-2", now)[0].entries.length, 4);
  assert.ok(groupSensorOverview(entries, "", now, true).every(group => group.status === "error" && group.attentionCount === 4));
});
