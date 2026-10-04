import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCareTasks,
  groupCareTasks,
  careTaskDueLabel,
  completeCareTask,
  undoCareTask,
} from "../services/care-tasks";
import {
  createLocalStateStore,
  localStateKey,
  parseLocalState,
} from "../services/local-state-storage";
import { initialLocalState, type CareSchedule } from "../types/local-state";
import type { Plant } from "../types/plant";
import type { CareTask } from "../types/scan";
import type { GardenCareTask } from "../types/care-task";

test("presentation groups exact due times and leaves unscheduled and future urgent checks undated or upcoming", () => {
  const current = new Date(2026, 8, 4, 12);
  const task = (id: string, due: Date | null, priority: GardenCareTask["priority"] = "routine"): GardenCareTask => ({
    id, key: id, plantId: "p1", title: id, details: "", dueAt: due?.toISOString() ?? null, priority,
  });
  const pending = [
    task("yesterday", new Date(2026, 8, 3, 9)),
    task("earlier today", new Date(2026, 8, 4, 9)),
    task("now", current),
    task("tonight", new Date(2026, 8, 4, 23, 59, 59, 999)),
    task("future urgent", new Date(2026, 8, 5, 0), "immediate"),
    task("manual urgent", null, "immediate"),
    task("manual routine", null),
  ];
  const groups = groupCareTasks({ today: pending, upcoming: [], completed: [] }, current);
  assert.deepEqual(groups.overdue.map(task => task.id), ["yesterday", "earlier today"]);
  assert.deepEqual(groups.today.map(task => task.id), ["now", "tonight"]);
  assert.deepEqual(groups.upcoming.map(task => task.id), ["future urgent"]);
  assert.deepEqual(groups.manual.map(task => task.id), ["manual urgent", "manual routine"]);
  assert.equal(careTaskDueLabel(pending[5], current), "No due date");
  assert.match(careTaskDueLabel(pending[1], current), /^Overdue.*today/);
  assert.match(careTaskDueLabel(pending[2], current), /^Due today/);
  assert.equal(groupCareTasks({ today: [pending[3]], upcoming: [], completed: [] }, new Date(2026, 8, 5, 0)).overdue.length, 1);
});

test("completed recurring tasks stay in history while their next occurrence is upcoming; undo restores overdue", () => {
  const current = new Date(2026, 8, 4, 12);
  const state = { ...initialLocalState(), schedules: { p1: schedule } };
  const before = groupCareTasks(buildCareTasks([plant], state.schedules, [], current), current);
  const water = before.overdue.find(task => task.title.includes("watering"))!;
  const saved = completeCareTask(state, water, current);
  const after = groupCareTasks(buildCareTasks([plant], state.schedules, saved.careCompletions, current), current);
  assert.equal(after.completed[0].id, water.id);
  assert.ok(after.upcoming.some(task => task.key === water.key));
  const undone = undoCareTask(saved, water.id);
  assert.ok(groupCareTasks(buildCareTasks([plant], state.schedules, undone.careCompletions, current), current).overdue.some(task => task.id === water.id));
});

test("server tasks merge by urgency and due date, preserve completion and omit skipped/deleted targets", () => {
  const base: CareTask = {
    id: "t1",
    plantId: "p1",
    title: "Upload Actual Plant Image",
    taskType: "SCAN",
    description: "Take a new photo",
    status: "PENDING",
    urgency: "immediate",
    dueDate: "2026-09-30T09:00:00Z",
    completedAt: null,
    createdAt: "2026-09-01T09:00:00Z",
    plant: null,
  };
  const groups = buildCareTasks([plant], {}, [], now, [
    base,
    { ...base, id: "t2", urgency: "routine" },
    { ...base, id: "t3", status: "COMPLETED", completedAt: now.toISOString() },
    { ...base, id: "t4", status: "SKIPPED" },
    { ...base, id: "t5", plantId: "deleted" },
  ]);
  assert.ok(groups.today.some((task) => task.serverId === "t1"));
  assert.ok(groups.upcoming.some((task) => task.serverId === "t2"));
  assert.equal(groups.completed[0].serverId, "t3");
  assert.ok(
    ![...groups.today, ...groups.upcoming, ...groups.completed].some((task) =>
      ["t4", "t5"].includes(task.serverId ?? ""),
    ),
  );
});

const plant: Plant = {
  id: "p1",
  name: "Fern",
  species: "Fern",
  healthStatus: "unknown",
  createdAt: "2026-09-01T08:00:00Z",
  updatedAt: "2026-09-01T08:00:00Z",
};
const schedule: CareSchedule = {
  plantId: plant.id,
  wateringDays: 2,
  waterMl: 100,
  fertilizingDays: 30,
  fertilizer: "Balanced",
  rotationDays: 7,
  reminderTime: "09:00",
  updatedAt: new Date(2026, 8, 1, 8).toISOString(),
};
const now = new Date(2026, 8, 4, 12);

test("aggregates all plants, prioritizes urgent recommendations, and does not invent healthy readings", () => {
  const groups = buildCareTasks(
    [
      {
        ...plant,
        healthStatus: "critical",
        recommendations: [
          {
            action: "Inspect roots",
            details: "Look for damage",
            urgency: "urgent",
          },
          {
            action: "Review placement",
            details: "Indirect light",
            urgency: "routine",
          },
        ],
      },
      { ...plant, id: "p2", lastScannedAt: plant.updatedAt },
    ],
    {},
    [],
    now,
  );
  assert.ok(
    groups.today.some((task) => task.title === "Scan actual plant image"),
  );
  assert.ok(groups.today.some((task) => task.title === "Inspect roots"));
  assert.ok(groups.today.some((task) => task.title === "Inspect plant health"));
  assert.ok(groups.upcoming.some((task) => task.plantId === "p2"));
  assert.ok(groups.upcoming.some((task) => task.title === "Review placement"));
  assert.ok(
    groups.upcoming
      .filter((task) => task.title === "Check soil moisture")
      .every((task) => task.details.includes("Manual check")),
  );
  assert.equal(
    buildCareTasks([{ ...plant, id: "guest-1" }], {}, [], now).today.length,
    0,
  );
});

test("saved schedules group overdue/today separately from future checks and preserve reminder time", () => {
  const groups = buildCareTasks([plant], { p1: schedule }, [], now);
  const water = groups.today.find((task) => task.title.includes("watering"))!;
  assert.equal(new Date(water.dueAt!).getDate(), 3);
  assert.equal(new Date(water.dueAt!).getHours(), 9);
  assert.equal(groups.upcoming.length, 2);
  const dueToday = buildCareTasks(
    [plant],
    { p1: schedule },
    [],
    new Date(2026, 8, 3, 0),
  );
  assert.ok(dueToday.today.some((task) => task.id === water.id));
});

test("completion is idempotent, recurring checks advance, undo restores occurrence", () => {
  const initial = { ...initialLocalState(), schedules: { p1: schedule } };
  const water = buildCareTasks([plant], initial.schedules, [], now).today.find(
    (task) => task.title.includes("watering"),
  )!;
  const saved = completeCareTask(initial, water, now);
  assert.equal(completeCareTask(saved, water, now).careCompletions.length, 1);
  const groups = buildCareTasks(
    [plant],
    initial.schedules,
    saved.careCompletions,
    now,
  );
  assert.equal(groups.completed.length, 1);
  const next = groups.upcoming.find((task) => task.key === water.key)!;
  assert.notEqual(next.id, water.id);
  assert.equal(new Date(next.dueAt!).getDate(), 6);
  const undone = undoCareTask(saved, water.id);
  assert.ok(
    buildCareTasks(
      [plant],
      initial.schedules,
      undone.careCompletions,
      now,
    ).today.some((task) => task.id === water.id),
  );
});

test("one-off tasks stay complete; updated versions renew tasks; deleted plants leave the hub", () => {
  const task = buildCareTasks([plant], {}, [], now).today[0];
  const state = completeCareTask(initialLocalState(), task, now);
  assert.equal(
    buildCareTasks([plant], {}, state.careCompletions, now).today.length,
    0,
  );
  assert.equal(
    buildCareTasks(
      [{ ...plant, updatedAt: now.toISOString() }],
      {},
      state.careCompletions,
      now,
    ).today.length,
    1,
  );
  assert.deepEqual(buildCareTasks([], {}, state.careCompletions, now), {
    today: [],
    upcoming: [],
    completed: [],
  });
});

test("legacy local state migrates completions; invalid history fails closed", () => {
  const { careCompletions: omitted, ...legacy } = initialLocalState();
  void omitted;
  assert.deepEqual(parseLocalState(legacy).careCompletions, []);
  const task = buildCareTasks([plant], {}, [], now).today[0];
  const state = completeCareTask(initialLocalState(), task, now);
  assert.deepEqual(parseLocalState(state), state);
  assert.throws(() =>
    parseLocalState({
      ...state,
      careCompletions: [{ ...state.careCompletions[0], completedAt: "bad" }],
    }),
  );
  assert.throws(() =>
    parseLocalState({
      ...state,
      careCompletions: [state.careCompletions[0], state.careCompletions[0]],
    }),
  );
});

test("completions survive remount, stay account-scoped, and failed writes do not check off tasks", async () => {
  const values = new Map<string, string>();
  let fail = false;
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (fail) throw new Error("Disk full");
      values.set(key, value);
    },
  };
  const a = createLocalStateStore(storage, localStateKey("a"));
  const b = createLocalStateStore(storage, localStateKey("b"));
  const guest = createLocalStateStore(storage, localStateKey(null));
  await Promise.all([a.load(), b.load(), guest.load()]);
  const task = buildCareTasks([plant], {}, [], now).today[0];
  fail = true;
  await assert.rejects(
    a.update((state) => completeCareTask(state, task, now)),
    /Disk full/,
  );
  assert.equal(a.snapshot().data.careCompletions.length, 0);
  fail = false;
  await a.update((state) => completeCareTask(state, task, now));
  const restored = createLocalStateStore(storage, localStateKey("a"));
  await restored.load();
  assert.equal(restored.snapshot().data.careCompletions.length, 1);
  assert.equal(b.snapshot().data.careCompletions.length, 0);
  assert.equal(guest.snapshot().data.careCompletions.length, 0);
});
