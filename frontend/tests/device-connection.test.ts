import assert from "node:assert/strict";
import test from "node:test";
import {
  connectedDeviceFromMock,
  createMockConnection,
  deviceTargets,
  findMockDevice,
  isConnectedDevice,
  isMockDeviceConnection,
  mockDeviceDelay,
  mockHardwareNodes,
  parsePreselectedTarget,
  resolveDeviceTarget,
  upsertConnectedDevice,
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
const connectedDevice = connectedDeviceFromMock(connection);

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
    connectedDevices: [connectedDevice],
  }));
  const restored = createLocalStateStore(storage, localStateKey("A"));
  await restored.load();
  assert.deepEqual(restored.snapshot().data.connectedDevices, [
    connectedDevice,
  ]);
  assert.equal(restored.snapshot().data.onboarding.mode, null);
  for (const id of ["B", null]) {
    const other = createLocalStateStore(storage, localStateKey(id));
    await other.load();
    assert.deepEqual(other.snapshot().data.connectedDevices, []);
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
    store.update((state) => ({
      ...state,
      connectedDevices: [connectedDevice],
    }));
  await assert.rejects(save());
  assert.deepEqual(store.snapshot().data.connectedDevices, []);
  fail = false;
  await save();
  assert.deepEqual(store.snapshot().data.connectedDevices, [connectedDevice]);
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
    return { ...state, connectedDevices: [connectedDevice] };
  });
  const rejected = assert.rejects(cancelled, /Cancelled/);
  abort.abort();
  release();
  await first;
  await rejected;
  assert.equal(writes, 1);
  assert.deepEqual(store.snapshot().data.connectedDevices, []);
  await store.update((state) => ({
    ...state,
    connectedDevices: [connectedDevice],
  }));
  assert.equal(writes, 2);
  assert.equal(store.snapshot().data.experience, "beginner");
  assert.deepEqual(store.snapshot().data.connectedDevices, [connectedDevice]);
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
  assert.deepEqual(store.snapshot().data.connectedDevices, []);
  await assert.rejects(
    store.update((state) => state),
    /not ready/,
  );
  assert.equal(writes, 0);
});

test("legacy single connection migrates once without resurrecting removed devices", () => {
  const { connectedDevices: _devices, ...legacy } = initialLocalState();
  assert.deepEqual(parseLocalState(legacy).connectedDevices, []);
  const migrated = parseLocalState({
    ...legacy,
    mockDeviceConnection: connection,
  });
  assert.deepEqual(migrated.connectedDevices, [connectedDevice]);
  assert.equal(migrated.mockDeviceConnection, undefined);
  assert.deepEqual(
    parseLocalState({ ...migrated, connectedDevices: [] }).connectedDevices,
    [],
  );
  assert.deepEqual(
    parseLocalState({
      ...legacy,
      mockDeviceConnection: connection,
      connectedDevices: [],
    }).connectedDevices,
    [],
  );
});

test("multiple sensors append, reassignment replaces only the matching identity", () => {
  const second = connectedDeviceFromMock(
    createMockConnection(mockHardwareNodes[1].id, targets[1], targets),
  );
  const both = upsertConnectedDevice([connectedDevice], second);
  assert.equal(both.length, 2);
  assert.deepEqual(upsertConnectedDevice(both, second), both);
  const reassigned = {
    ...connectedDevice,
    assignedType: "plant" as const,
    assignedId: plant.id,
    targetName: plant.name,
  };
  assert.deepEqual(upsertConnectedDevice(both, reassigned), [
    reassigned,
    second,
  ]);
  assert.deepEqual(both[0], connectedDevice);
  assert.deepEqual(
    parseLocalState({ ...initialLocalState(), connectedDevices: both })
      .connectedDevices,
    both,
  );
  assert.deepEqual(second.telemetry, {});
});

test("device collections fail closed on corrupt, duplicate, or spoofed live entries", () => {
  for (const invalid of [
    null,
    {},
    { ...connectedDevice, source: "live" },
    { ...connectedDevice, assignedId: " " },
    { ...connectedDevice, name: "spoofed" },
    { ...connectedDevice, telemetry: { humidity: NaN } },
    { ...connectedDevice, telemetry: { soilMoisture: Infinity } },
    { ...connectedDevice, telemetry: { ph: 7 } },
  ]) {
    assert.equal(isConnectedDevice(invalid), false);
    assert.throws(() =>
      parseLocalState({ ...initialLocalState(), connectedDevices: [invalid] }),
    );
  }
  assert.throws(() =>
    parseLocalState({
      ...initialLocalState(),
      connectedDevices: [connectedDevice, connectedDevice],
    }),
  );
  assert.throws(() =>
    parseLocalState({ ...initialLocalState(), connectedDevices: {} }),
  );
});

test("contextual targets lock selection and invalid or deleted destinations never fall back", () => {
  assert.equal(parsePreselectedTarget(undefined, undefined), undefined);
  for (const [type, id] of [
    ["plant", undefined],
    [undefined, "p1"],
    ["account", "p1"],
    [["plant"], "p1"],
    ["plant", ["p1"]],
    ["space", " "],
    ["space", "x".repeat(201)],
  ]) {
    const parsed = parsePreselectedTarget(type, id);
    assert.equal(parsed, null);
    assert.equal(resolveDeviceTarget(parsed, targets[0], targets), null);
  }
  const parsed = parsePreselectedTarget("plant", plant.id);
  assert.deepEqual(parsed, { type: "plant", id: plant.id });
  assert.deepEqual(
    resolveDeviceTarget(parsed, targets[0], targets),
    targets[1],
  );
  assert.equal(resolveDeviceTarget(parsed, targets[0], [targets[0]]), null);
  assert.deepEqual(
    resolveDeviceTarget(undefined, targets[0], targets),
    targets[0],
  );
  const unicode = {
    kind: "space" as const,
    id: "Patio / 蘭 & herbs",
    name: "Patio / 蘭 & herbs",
  };
  assert.deepEqual(
    resolveDeviceTarget(parsePreselectedTarget("space", unicode.id), null, [
      unicode,
    ]),
    unicode,
  );
});

test("concurrent pairing preserves multiple sensors across reload and removal", async () => {
  let raw: string | null = null;
  const storage = {
    getItem: async () => raw,
    setItem: async (_key: string, value: string) => {
      raw = value;
    },
  };
  const store = createLocalStateStore(storage, "multi-sensor");
  await store.load();
  const second = connectedDeviceFromMock(
    createMockConnection(mockHardwareNodes[1].id, targets[1], targets),
  );
  await Promise.all(
    [connectedDevice, second].map((device) =>
      store.update((state) => ({
        ...state,
        connectedDevices: upsertConnectedDevice(state.connectedDevices, device),
      })),
    ),
  );
  const restored = createLocalStateStore(storage, "multi-sensor");
  await restored.load();
  assert.deepEqual(restored.snapshot().data.connectedDevices, [
    connectedDevice,
    second,
  ]);
  await restored.update((state) => ({
    ...state,
    connectedDevices: state.connectedDevices.filter(
      (device) => device.id !== connectedDevice.id,
    ),
  }));
  assert.deepEqual(restored.snapshot().data.connectedDevices, [second]);
  await restored.update((state) => ({ ...state, connectedDevices: [] }));
  await store.load();
  assert.deepEqual(store.snapshot().data.connectedDevices, []);
});
