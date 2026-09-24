import assert from "node:assert/strict";
import test from "node:test";
import {
    scheduleInputError,
    suggestedCareSchedule,
} from "../services/care-schedule";
import {
    createLocalStateStore,
    localStateKey,
    parseLocalState,
    type LocalStorageAdapter,
} from "../services/local-state-storage";
import { initialLocalState } from "../types/local-state";

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: LocalStorageAdapter = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
  return { values, storage };
}

test("new state hydrates without writing defaults", async () => {
  const { storage, values } = memoryStorage();
  const store = createLocalStateStore(storage, "fresh");
  assert.equal(store.snapshot().ready, false);
  await assert.rejects(
    store.update((s) => s),
    /not ready/,
  );
  await store.load();
  assert.equal(store.snapshot().ready, true);
  assert.deepEqual(store.snapshot().data, initialLocalState());
  assert.equal(values.size, 0);
});

test("account keys cannot overlap guest or other accounts", () => {
  assert.notEqual(localStateKey(null), localStateKey("guest"));
  assert.notEqual(localStateKey("a:b"), localStateKey("a%3Ab"));
});

test("serialized updates and remounted stores preserve independent changes", async () => {
  const { storage } = memoryStorage();
  const a = createLocalStateStore(storage, "shared");
  const b = createLocalStateStore(storage, "shared");
  await Promise.all([a.load(), b.load()]);
  await Promise.all([
    a.update((s) => ({ ...s, experience: "beginner" })),
    b.update((s) => ({ ...s, onboarding: { ...s.onboarding, step: "space" } })),
  ]);
  await a.load();
  assert.equal(a.snapshot().data.experience, "beginner");
  assert.equal(a.snapshot().data.onboarding.step, "space");
});

test("corrupt and future-version data are not overwritten", async () => {
  for (const raw of [
    "{broken",
    JSON.stringify({ ...initialLocalState(), version: 2 }),
  ]) {
    const { storage, values } = memoryStorage();
    values.set("corrupt", raw);
    const store = createLocalStateStore(storage, "corrupt");
    await store.load();
    assert.equal(store.snapshot().ready, false);
    assert.ok(store.snapshot().error);
    await assert.rejects(store.update((s) => s));
    assert.equal(values.get("corrupt"), raw);
  }
});

test("failed write keeps committed state and queue remains usable", async () => {
  const { storage } = memoryStorage();
  let fail = true;
  const store = createLocalStateStore(
    {
      ...storage,
      setItem: async (key, value) => {
        if (fail) throw new Error("Disk full");
        await storage.setItem(key, value);
      },
    },
    "write-error",
  );
  await store.load();
  await assert.rejects(
    store.update((s) => ({ ...s, experience: "experienced" })),
    /Disk full/,
  );
  assert.equal(store.snapshot().data.experience, null);
  fail = false;
  await store.update((s) => ({ ...s, experience: "experienced" }));
  assert.equal(store.snapshot().data.experience, "experienced");
});

test("complete setup and care schedule survive a new store", async () => {
  const { storage } = memoryStorage();
  const key = "completed";
  const store = createLocalStateStore(storage, key);
  await store.load();
  const schedule = suggestedCareSchedule(
    "plant-1",
    "Monstera deliciosa",
    "medium",
  );
  await store.update((s) => ({
    ...s,
    experience: "beginner",
    schedules: { "plant-1": schedule },
    spaces: [
      {
        id: "bedroom",
        name: "Bedroom",
        theme: "bedroom",
        light: "medium",
        createdAt: new Date().toISOString(),
      },
    ],
    onboarding: {
      status: "completed",
      step: "care",
      plantId: "plant-1",
      spaceId: "bedroom",
      mode: "manual",
    },
  }));
  const restored = createLocalStateStore(storage, key);
  await restored.load();
  assert.deepEqual(restored.snapshot().data, store.snapshot().data);
});

test("invalid choices, duplicate spaces, and impossible steps fail validation", () => {
  const state = initialLocalState();
  assert.throws(() => parseLocalState({ ...state, experience: "expert-ish" }));
  assert.throws(() =>
    parseLocalState({
      ...state,
      onboarding: { ...state.onboarding, step: "care" },
    }),
  );
  const space = {
    id: "one",
    name: "Bedroom",
    theme: "bedroom",
    light: "medium",
    createdAt: new Date().toISOString(),
  };
  assert.throws(() =>
    parseLocalState({
      ...state,
      spaces: [space, { ...space, id: "two", name: "bedroom" }],
    }),
  );
});

test("care defaults vary by plant and light and reject unsafe input ranges", () => {
  const schedule = suggestedCareSchedule("p", "Monstera deliciosa");
  assert.equal(schedule.wateringDays, 10);
  assert.equal(
    suggestedCareSchedule("p", "Monstera deliciosa", "low").wateringDays,
    13,
  );
  assert.equal(
    suggestedCareSchedule("p", "Dracaena trifasciata").wateringDays,
    21,
  );
  assert.equal(scheduleInputError(schedule), null);
  for (const invalid of [
    { waterMl: 0 },
    { wateringDays: 1.5 },
    { rotationDays: 366 },
    { reminderTime: "24:00" },
    { fertilizer: " " },
  ]) {
    assert.ok(scheduleInputError({ ...schedule, ...invalid }));
    assert.throws(() =>
      parseLocalState({
        ...initialLocalState(),
        schedules: { p: { ...schedule, ...invalid } },
      }),
    );
  }
});
