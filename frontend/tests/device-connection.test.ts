import assert from "node:assert/strict";
import test from "node:test";
import {
  createMockConnection,
  deviceTargets,
  findMockDevice,
  isMockDeviceConnection,
  mockDeviceDelay,
  mockHardwareNodes,
} from "../services/device-connection";
import {
  createLocalStateStore,
  localStateKey,
  parseLocalState,
} from "../services/local-state-storage";
import { initialLocalState } from "../types/local-state";
import type { Plant } from "../types/plant";

const plant: Plant = {
  id: "p1",
  name: "Fern",
  species: "Fern",
  healthStatus: "unknown",
  createdAt: "2026-09-27T00:00:00Z",
  updatedAt: "2026-09-27T00:00:00Z",
};
const targets = deviceTargets(["Bedroom"], [plant]);
const connection = createMockConnection(
  mockHardwareNodes[0].id,
  targets[0],
  targets,
);

test("discovery contains only uniquely identified mock nodes and rejects invalid route parameters", () => {
  assert.equal(
    new Set(mockHardwareNodes.map((node) => node.id)).size,
    mockHardwareNodes.length,
  );
  assert.equal(findMockDevice("real-sensor"), undefined);
  assert.equal(findMockDevice([mockHardwareNodes[0].id]), undefined);
  assert.equal(findMockDevice(undefined), undefined);
});

test("assignment supports existing spaces and plants without mutating sensor links", () => {
  assert.deepEqual(
    targets.map((target) => target.kind),
    ["space", "plant"],
  );
  assert.equal(
    createMockConnection(mockHardwareNodes[1].id, targets[1], targets).target
      .id,
    plant.id,
  );
  assert.equal(plant.deviceId, undefined);
  assert.equal(plant.simulated, undefined);
  assert.deepEqual(deviceTargets([], []), []);
  assert.throws(() =>
    createMockConnection("physical-device", targets[0], targets),
  );
  assert.throws(
    () => createMockConnection(mockHardwareNodes[0].id, targets[0], []),
    /no longer available/,
  );
});

test("existing v1 state stays valid; malformed mock assignments fail closed", () => {
  assert.deepEqual(parseLocalState(initialLocalState()), initialLocalState());
  assert.equal(isMockDeviceConnection(connection), true);
  for (const invalid of [
    null,
    {},
    { ...connection, source: "live" },
    { ...connection, deviceId: "physical" },
    { ...connection, connectedAt: "bad-date" },
    { ...connection, target: { ...connection.target, kind: "account" } },
    { ...connection, target: { ...connection.target, id: " " } },
  ]) {
    assert.equal(isMockDeviceConnection(invalid), false);
    assert.throws(() =>
      parseLocalState({
        ...initialLocalState(),
        mockDeviceConnection: invalid,
      }),
    );
  }
});

test("completed assignments survive reload and remain isolated from other accounts and guests", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const account = createLocalStateStore(storage, localStateKey("A"));
  await account.load();
  await account.update((state) => ({
    ...state,
    mockDeviceConnection: connection,
  }));
  const restored = createLocalStateStore(storage, localStateKey("A"));
  await restored.load();
  assert.deepEqual(restored.snapshot().data.mockDeviceConnection, connection);
  assert.equal(restored.snapshot().data.onboarding.mode, null);
  for (const id of ["B", null]) {
    const other = createLocalStateStore(storage, localStateKey(id));
    await other.load();
    assert.equal(other.snapshot().data.mockDeviceConnection, undefined);
  }
});

test("failed persistence does not publish a successful connection and retry succeeds", async () => {
  let fail = true;
  const store = createLocalStateStore(
    {
      getItem: async () => null,
      setItem: async () => {
        if (fail) throw new Error("Disk unavailable");
      },
    },
    "device-write-failure",
  );
  await store.load();
  const save = () =>
    store.update((state) => ({ ...state, mockDeviceConnection: connection }));
  await assert.rejects(save());
  assert.equal(store.snapshot().data.mockDeviceConnection, undefined);
  fail = false;
  await save();
  assert.deepEqual(store.snapshot().data.mockDeviceConnection, connection);
});

test("mock delays finish only after their timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let completed = false;
  const pending = mockDeviceDelay(2400, new AbortController().signal).then(
    () => {
      completed = true;
    },
  );
  t.mock.timers.tick(2399);
  await Promise.resolve();
  assert.equal(completed, false);
  t.mock.timers.tick(1);
  await pending;
  assert.equal(completed, true);
});

test("cancelled and already-aborted mock work never completes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const preAborted of [false, true]) {
    const controller = new AbortController();
    if (preAborted) controller.abort();
    const pending = mockDeviceDelay(1400, controller.signal);
    controller.abort();
    await assert.rejects(pending, /cancelled/);
    t.mock.timers.tick(5000);
  }
});

test("a cancelled queued assignment never writes and the queue remains usable", async () => {
  let release!: () => void;
  let began!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let raw: string | null = null;
  let writes = 0;
  const store = createLocalStateStore(
    {
      getItem: async () => raw,
      setItem: async (_key, value) => {
        writes += 1;
        if (writes === 1) {
          began();
          await blocked;
        }
        raw = value;
      },
    },
    "device-cancelled-queue",
  );
  await store.load();
  const first = store.update((state) => ({ ...state, experience: "beginner" }));
  await started;
  const abort = new AbortController();
  const cancelled = store.update((state) => {
    // Same cancellation boundary used by the assignment screen's updater.
    if (abort.signal.aborted) throw new Error("Cancelled");
    return { ...state, mockDeviceConnection: connection };
  });
  const rejected = assert.rejects(cancelled, /Cancelled/);
  abort.abort();
  release();
  await first;
  await rejected;
  assert.equal(writes, 1);
  assert.equal(store.snapshot().data.mockDeviceConnection, undefined);
  await store.update((state) => ({
    ...state,
    mockDeviceConnection: connection,
  }));
  assert.equal(writes, 2);
  assert.equal(store.snapshot().data.experience, "beginner");
  assert.deepEqual(store.snapshot().data.mockDeviceConnection, connection);
});

test("invalid persisted mock assignment blocks loading and preserves stored data", async () => {
  const raw = JSON.stringify({
    ...initialLocalState(),
    mockDeviceConnection: { ...connection, source: "live" },
  });
  let writes = 0;
  const store = createLocalStateStore(
    {
      getItem: async () => raw,
      setItem: async () => {
        writes += 1;
      },
    },
    "device-corrupt-assignment",
  );
  await store.load();
  assert.equal(store.snapshot().ready, false);
  assert.ok(store.snapshot().error);
  assert.equal(store.snapshot().data.mockDeviceConnection, undefined);
  await assert.rejects(
    store.update((state) => state),
    /not ready/,
  );
  assert.equal(writes, 0);
});
