import assert from "node:assert/strict";
import test from "node:test";
import { filterCareTaskPeriod } from "../services/care-task-filter";
import type { GardenCareTask } from "../types/care-task";

test("Monday calendar filters retain overdue/manual checks and distinguish exact week boundaries", () => {
  const now = new Date(2026, 9, 4, 12); // Sunday, local calendar time.
  const task = (id: string, date: Date | null): GardenCareTask => ({ id, key: id, plantId: "p", title: id, details: "", dueAt: date?.toISOString() ?? null, priority: "routine" });
  const tasks = [task("overdue", new Date(2026, 8, 1)), task("manual", null), task("sunday", new Date(2026, 9, 4, 23, 59)), task("next", new Date(2026, 9, 5)), task("last", new Date(2026, 9, 11, 23, 59)), task("later", new Date(2026, 9, 12))];
  assert.deepEqual(filterCareTaskPeriod(tasks, "This Week", now).map(t => t.id), ["overdue", "manual", "sunday"]);
  assert.deepEqual(filterCareTaskPeriod(tasks, "Next Week", now).map(t => t.id), ["next", "last"]);
  assert.deepEqual(filterCareTaskPeriod(tasks, "Later", now).map(t => t.id), ["later"]);
  assert.equal(tasks[1].dueAt, null);
  const monday = new Date(2026, 9, 5);
  assert.ok(filterCareTaskPeriod(tasks, "This Week", monday).some(t => t.id === "next"));
  assert.ok(filterCareTaskPeriod(tasks, "Next Week", monday).some(t => t.id === "later"));
});

test("completed views use completion timestamps rather than inventing manual due dates", () => {
  const task = { id: "manual", key: "manual", plantId: "p", title: "Check", details: "", dueAt: null, priority: "routine" as const, completedAt: new Date(2026, 9, 5).toISOString() };
  assert.equal(filterCareTaskPeriod([task], "This Week", new Date(2026, 9, 4)).length, 0);
  assert.equal(filterCareTaskPeriod([task], "Next Week", new Date(2026, 9, 4)).length, 1);
  assert.equal(task.dueAt, null);
});
