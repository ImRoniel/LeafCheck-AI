import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import ts from "typescript";
import { selectPlantGuidance } from "../services/plant-guidance";
import { profileCareTasks } from "../services/plant-profile-guidance";
import type { ArchiveEntry, CareTask } from "../types";
const requireModule = createRequire(import.meta.url);
const plantId = "plant", createdAt = "2026-10-12T00:00:00Z";
const archive: ArchiveEntry = { id: "archive", plantId, userId: "owner", healthStatus: "healthy", rawAnalysisText: "Saved diagnosis", speciesName: "Fern", notificationTime: null, notificationReason: null, createdAt, plant: null };
const task: CareTask = { id: "task", plantId, title: "Check soil", taskType: "WATERING", description: null, status: "PENDING", urgency: "routine", dueDate: createdAt, createdAt, completedAt: null, plant: null };
type Snapshot = { key: string; latest?: ArchiveEntry | null; pending?: CareTask[] };
type Resource = { data: Snapshot | null; loading: boolean; error: Error | null; refresh: () => Promise<void> };
function harness(fail: "archives" | "tasks") {
  const resources = new Map<string, Resource>(); let generation = 1, failed = true;
  const exports: { usePlantProfileGuidance?: (id: string, enabled: boolean) => { data: { latest: ArchiveEntry | null; pending: CareTask[] }; error: Error | null; tasksError: Error | null; refresh: () => Promise<unknown> } } = {};
  runInNewContext(ts.transpileModule(readFileSync("hooks/use-plant-profile-guidance.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require(name: string) {
      if (name === "@/context/auth") return { useAuth: () => ({ generation }) };
      if (name === "@/services/api") return { api: {
        fetchArchives: async () => { if (failed && fail === "archives") throw new Error("Archive unavailable"); return [archive]; },
        fetchTasks: async () => { if (failed && fail === "tasks") throw new Error("Tasks unavailable"); return [task]; },
      } };
      if (name === "@/services/plant-guidance") return { selectPlantGuidance };
      if (name === "@/services/plant-profile-guidance") return { profileCareTasks };
      if (name === "@/services/use-polling-resource") return { usePollingResource: (key: string, load: (signal: AbortSignal) => Promise<Snapshot>) => {
        if (!key) return { data: null, loading: false, error: null, refresh: async () => {} };
        if (!resources.has(key)) {
          const resource: Resource = { data: null, loading: true, error: null, refresh: async () => {
            resource.loading = true;
            try { resource.data = await load(new AbortController().signal); resource.error = null; }
            catch (error: unknown) { resource.error = error as Error; throw error; }
            finally { resource.loading = false; }
          } };
          resources.set(key, resource); void resource.refresh().catch(() => undefined);
        }
        return resources.get(key);
      } };
      return requireModule(name);
    },
  });
  return { render: (enabled = true) => exports.usePlantProfileGuidance!(plantId, enabled), recover: () => { failed = false; }, session: () => { generation++; } };
}
for (const failed of ["archives", "tasks"] as const) {
  test(`${failed} failure leaves the other profile section loaded and can recover independently`, async () => {
    const h = harness(failed); h.render(); await nextTurn();
    let result = h.render();
    if (failed === "tasks") { assert.equal(result.data.latest?.rawAnalysisText, "Saved diagnosis"); assert.ok(result.tasksError); assert.equal(result.error, null); }
    else { assert.equal(result.data.pending[0].id, task.id); assert.ok(result.error); assert.equal(result.tasksError, null); }
    h.recover(); await result.refresh(); result = h.render();
    assert.equal(result.data.latest?.id, archive.id); assert.equal(result.data.pending.length, 1);
    assert.equal(result.error, null); assert.equal(result.tasksError, null);
    h.session(); result = h.render(); assert.equal(result.data.latest, null); assert.equal(result.data.pending.length, 0);
    assert.equal(h.render(false).data.latest, null);
  });
}
