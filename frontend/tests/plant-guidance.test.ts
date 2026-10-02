import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../services/api";
import { selectPlantGuidance, telemetryGuidance } from "../services/plant-guidance";
import type { ArchiveEntry, CareTask } from "../types";

const now = Date.parse("2026-10-02T12:00:00Z");
test("telemetry guidance distinguishes fresh, stale, missing, failed, simulated and unverified data", () => {
  const timestamp = new Date(now).toISOString();
  assert.equal(telemetryGuidance(timestamp, { linked: true }, now).degraded, false);
  for (const [value, options] of [
    [null, { linked: true }],
    ["invalid", { linked: true }],
    [new Date(now - 30 * 60_000 - 1).toISOString(), { linked: true }],
    [new Date(now + 61_000).toISOString(), { linked: true }],
    [timestamp, { linked: true, failed: true }],
    [timestamp, { linked: true, simulated: true }],
    [timestamp, { linked: false }],
  ] as const) assert.equal(telemetryGuidance(value, options, now).degraded, true);
  assert.match(telemetryGuidance(null, { linked: true }, now).message, /No current sensor readings/);
  assert.match(telemetryGuidance(new Date(now - 31 * 60_000).toISOString(), { linked: true }, now).message, /stale/);
});

test("guidance selects the latest diagnosis and pending tasks only for the requested plant", () => {
  const archive: ArchiveEntry = {
    id: "old", plantId: "p", userId: "owner", healthStatus: "warning",
    rawAnalysisText: "Inspect the leaves", speciesName: "Fern", notificationTime: null,
    notificationReason: null, createdAt: "2026-10-01T12:00:00Z", plant: null,
  };
  const task: CareTask = {
    id: "task", plantId: "p", title: "Inspect", taskType: "OTHER", description: null,
    status: "PENDING", urgency: "routine", dueDate: "2026-10-03T12:00:00Z",
    completedAt: null, createdAt: archive.createdAt, plant: null,
  };
  const archives = [archive, { ...archive, id: "other", plantId: "other", createdAt: "2026-10-03T12:00:00Z" }, { ...archive, id: "latest", createdAt: "2026-10-02T12:00:00Z" }];
  const tasks = [task, { ...task, id: "other", plantId: "other" }, { ...task, id: "done", status: "COMPLETED" }];
  assert.equal(selectPlantGuidance("p", archives, tasks).latest?.id, "latest");
  assert.deepEqual(selectPlantGuidance("p", archives, tasks).pending, [task]);
  assert.deepEqual(selectPlantGuidance("missing", archives, tasks), { latest: null, pending: [] });
  assert.equal(archives[0].id, "old");
});

test("guidance API includes an encoded plant filter and preserves unfiltered history", async () => {
  const urls: string[] = [];
  const api = createApiClient({ baseUrl: "https://api.test", fetch: async (url) => {
    urls.push(String(url));
    return Response.json([]);
  } });
  await api.fetchArchives({ plantId: "p/1" });
  await api.fetchTasks({ plantId: "p/1" });
  await api.fetchArchives();
  assert.deepEqual(urls, ["https://api.test/api/scan/archives?plantId=p%2F1", "https://api.test/api/scan/tasks?plantId=p%2F1", "https://api.test/api/scan/archives"]);
});
