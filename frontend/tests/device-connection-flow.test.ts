import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import * as devices from "../services/device-connection";
import { createLocalStateStore } from "../services/local-state-storage";
import { initialLocalState } from "../types/local-state";

const loadModule = createRequire(`${process.cwd()}/package.json`);
type Props = {
  children?: React.ReactNode;
  label?: string;
  disabled?: boolean;
  onPress?: () => void;
  onCancel?: () => void;
  ListFooterComponent?: React.ReactNode;
  href?: string;
};
function action(node: React.ReactNode, label: string): Props {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<Props>(child)) continue;
    if (child.props.label === label) return child.props;
    for (const nested of [
      child.props.children,
      child.props.ListFooterComponent,
    ]) {
      if (!nested) continue;
      try {
        return action(nested, label);
      } catch {
        // Continue searching sibling elements, without rendering native views.
      }
    }
  }
  throw new Error(`Action not found: ${label}`);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Execute production handlers, not copies of their updater callbacks. This is
// a hook/element unit harness, not proof of native or browser navigation behavior.
async function harness(screen = "assignment") {
  let raw: string | null = null;
  let writes = 0;
  let failWrite = false;
  let writeGate: ReturnType<typeof deferred> | undefined;
  const store = createLocalStateStore(
    {
      getItem: async () => raw,
      setItem: async (_key, value) => {
        writes++;
        await writeGate?.promise;
        if (failWrite) throw new Error("Storage denied");
        raw = value;
      },
    },
    `screen-flow-${screen}`,
  );
  await store.load();
  let params: Record<string, unknown> = {
    deviceId: devices.mockHardwareNodes[0].id,
    targetType: "space",
    targetId: "Bedroom",
  };
  let active = true;
  let spaces = ["Bedroom", "Patio"];
  let cursor = 0;
  const slots: unknown[] = [];
  const effects = new Map<number, { deps?: unknown[]; dispose?: () => void }>();
  let pending: (() => void)[] = [];
  const navigations: unknown[] = [];
  const exports = {} as { default: () => React.ReactElement<Props> };
  function effect(run: () => void | (() => void), deps?: unknown[]) {
    const index = cursor++;
    const previous = effects.get(index);
    if (
      previous &&
      deps &&
      previous.deps?.length === deps.length &&
      deps.every((value, i) => Object.is(value, previous.deps?.[i]))
    )
      return;
    pending.push(() => {
      previous?.dispose?.();
      effects.set(index, { deps, dispose: run() || undefined });
    });
  }
  runInNewContext(
    ts.transpileModule(
      readFileSync(`app/device-connection/${screen}.tsx`, "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      AbortController,
      setTimeout,
      clearTimeout,
      require(name: string) {
        switch (name) {
          case "react":
            return {
              useState(initial: unknown) {
                const index = cursor++;
                if (!(index in slots)) slots[index] = initial;
                return [
                  slots[index],
                  (value: unknown) => {
                    slots[index] = value;
                  },
                ];
              },
              useRef(initial: unknown) {
                const index = cursor++;
                if (!(index in slots)) slots[index] = { current: initial };
                return slots[index];
              },
              useEffect: effect,
              useLayoutEffect: effect,
            };
          case "react/jsx-runtime":
            return loadModule(name);
          case "react-native":
            return {
              FlatList: "FlatList",
              Pressable: "Pressable",
              Text: "Text",
              View: "View",
              ScrollView: "ScrollView",
            };
          case "@/components/device-connection-screen":
            return {
              DeviceConnectionScreen: "DeviceConnectionScreen",
              deviceStyles: {},
            };
          case "@/components/screen":
            return {
              Action: "Action",
              Screen: "Screen",
              Notice: "Notice",
              ui: {},
            };
          case "@/context/app-data":
            return {
              useAppData: () => ({ loaded: true, loading: false, plants: [] }),
            };
          case "@/context/local-state":
            return {
              useLocalState: () => ({
                ...store.snapshot(),
                update: store.update,
              }),
            };
          case "@/context/spaces":
            return { useSpaces: () => ({ spaces }) };
          case "@/hooks/use-device-activity":
            return { useDeviceActivity: () => active };
          case "@/services/device-connection":
            return devices;
          case "@expo/vector-icons":
            return { Ionicons: "Icon" };
          case "expo-router":
            return {
              Redirect: "Redirect",
              useLocalSearchParams: () => params,
              useRouter: () => ({
                replace: (route: unknown) => navigations.push(route),
                push: (route: unknown) => navigations.push(route),
              }),
            };
          default:
            throw new Error(`Unexpected import: ${name}`);
        }
      },
    },
  );
  return {
    store,
    navigations,
    writes: () => writes,
    blockWrite: () => {
      writeGate = deferred();
      return writeGate;
    },
    failWrite: (value: boolean) => {
      failWrite = value;
    },
    params: (value: Record<string, unknown>) => {
      params = value;
    },
    spaces: (value: string[]) => {
      spaces = value;
    },
    active: (value: boolean) => {
      active = value;
    },
    render() {
      cursor = 0;
      pending = [];
      const node = exports.default();
      pending.forEach((run) => run());
      return node;
    },
    dispose() {
      effects.forEach(({ dispose }) => dispose?.());
    },
  };
}

test("actual assignment handler coalesces double taps and saves the locked target", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flow = await harness();
  t.after(flow.dispose);
  const node = flow.render();
  const connect = action(node, "Connect to selected destination");
  assert.equal(connect.disabled, false);
  connect.onPress?.();
  connect.onPress?.();
  t.mock.timers.tick(1400);
  await nextTurn();
  assert.equal(flow.writes(), 1);
  assert.equal(
    flow.store.snapshot().data.connectedDevices[0].assignedId,
    "Bedroom",
  );
  assert.equal(flow.navigations.length, 1);
});

for (const boundary of [
  "cancel",
  "blur",
  "unmount",
  "deleted target",
  "changed target",
]) {
  test(`actual assignment rejects queued work after ${boundary}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const flow = await harness();
    t.after(flow.dispose);
    const node = flow.render();
    const gate = flow.blockWrite();
    const earlier = flow.store.update((state) => ({
      ...state,
      experience: "beginner",
    }));
    await nextTurn();
    action(node, "Connect to selected destination").onPress?.();
    t.mock.timers.tick(1400);
    await nextTurn();
    if (boundary === "cancel") node.props.onCancel?.();
    if (boundary === "blur") {
      flow.active(false);
      flow.render();
    }
    if (boundary === "unmount") flow.dispose();
    if (boundary === "deleted target") {
      flow.spaces(["Patio"]);
      flow.render();
    }
    if (boundary === "changed target") {
      flow.params({
        deviceId: devices.mockHardwareNodes[0].id,
        targetType: "space",
        targetId: "Patio",
      });
      flow.render();
    }
    gate.resolve();
    await earlier;
    await nextTurn();
    assert.equal(flow.writes(), 1);
    assert.deepEqual(flow.store.snapshot().data.connectedDevices, []);
    assert.equal(flow.navigations.length, 0);
  });
}

test("cancel after the storage commit starts permits that save but suppresses navigation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flow = await harness();
  t.after(flow.dispose);
  const node = flow.render();
  const gate = flow.blockWrite();
  action(node, "Connect to selected destination").onPress?.();
  t.mock.timers.tick(1400);
  await nextTurn();
  assert.equal(flow.writes(), 1);
  node.props.onCancel?.();
  gate.resolve();
  await nextTurn();
  assert.equal(flow.store.snapshot().data.connectedDevices.length, 1);
  assert.equal(flow.navigations.length, 0);
});

test("management removal preserves all devices on failure and removes only its ID on retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const flow = await harness("manage");
  t.after(flow.dispose);
  const targets = devices.deviceTargets(["Bedroom"], []);
  const connected = devices.mockHardwareNodes
    .slice(0, 2)
    .map((node) =>
      devices.connectedDeviceFromMock(
        devices.createMockConnection(node.id, targets[0], targets),
      ),
    );
  await flow.store.update((state) => ({
    ...state,
    connectedDevices: connected,
  }));
  flow.failWrite(true);
  action(flow.render(), "Remove Leaf Node 01").onPress?.();
  await nextTurn();
  assert.deepEqual(flow.store.snapshot().data.connectedDevices, connected);
  assert.match(JSON.stringify(flow.render()), /could not be removed/);
  flow.failWrite(false);
  action(flow.render(), "Remove Leaf Node 01").onPress?.();
  await nextTurn();
  assert.deepEqual(flow.store.snapshot().data.connectedDevices, [connected[1]]);
});

test("success uses persisted identity and destination, not a forged targetName", async (t) => {
  const flow = await harness("success");
  t.after(flow.dispose);
  const targets = devices.deviceTargets(["Bedroom"], []);
  const saved = devices.connectedDeviceFromMock(
    devices.createMockConnection(
      devices.mockHardwareNodes[0].id,
      targets[0],
      targets,
    ),
  );
  await flow.store.update(() => ({
    ...initialLocalState(),
    connectedDevices: [saved],
  }));
  flow.params({ deviceId: saved.id, targetName: "Forged destination" });
  const output = JSON.stringify(flow.render());
  assert.match(output, /Bedroom/);
  assert.doesNotMatch(output, /Forged destination/);
  for (const deviceId of [undefined, "unknown", [saved.id]]) {
    flow.params({ deviceId });
    assert.equal(flow.render().props.href, "/device-connection/scanner");
  }
});

for (const boundary of ["queued", "commit started"]) {
  test(`actual local provider fences a session change when ${boundary}`, async () => {
    const gate = deferred();
    let raw: string | null = null;
    let writes = 0;
    const keys: string[] = [];
    const store = createLocalStateStore(
      {
        getItem: async () => raw,
        setItem: async (key, value) => {
          writes++;
          keys.push(key);
          await gate.promise;
          raw = value;
        },
      },
      `provider-session-${boundary}`,
    );
    await store.load();
    const auth = {
      generation: 1,
      status: "authenticated",
      isGuest: false,
      user: { id: "account-A" },
    };
    let current = { ...auth };
    const exports = {} as {
      LocalStateProvider: (props: object) => React.ReactElement<{
        value: { update: typeof store.update };
      }>;
    };
    runInNewContext(
      ts.transpileModule(readFileSync("context/local-state.tsx", "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      {
        exports,
        require(name: string) {
          switch (name) {
            case "react":
              return {
                createContext: () => ({ Provider: "Provider" }),
                useMemo: (create: () => unknown) => create(),
                useSyncExternalStore: (
                  _subscribe: unknown,
                  snapshot: () => unknown,
                ) => snapshot(),
                useEffect: () => {},
              };
            case "react/jsx-runtime":
              return loadModule(name);
            case "@/services/local-state-storage":
              return {
                createLocalStateStore: () => store,
                localStateKey: (id: string) => id,
              };
            case "@react-native-async-storage/async-storage":
              return {};
            case "./auth":
              return {
                useAuth: () => auth,
                session: { snapshot: () => current },
              };
            default:
              throw new Error(`Unexpected import: ${name}`);
          }
        },
      },
    );
    const local = exports.LocalStateProvider({}).props.value;
    const earlier =
      boundary === "queued"
        ? store.update((state) => ({ ...state, experience: "beginner" }))
        : Promise.resolve();
    await nextTurn();
    const targets = devices.deviceTargets(["Bedroom"], []);
    const saved = devices.connectedDeviceFromMock(
      devices.createMockConnection(
        devices.mockHardwareNodes[0].id,
        targets[0],
        targets,
      ),
    );
    const save = local.update((state) => ({
      ...state,
      connectedDevices: [saved],
    }));
    const rejected = assert.rejects(save, /Session changed/);
    await nextTurn();
    current = { ...auth, generation: 2, user: { id: "account-B" } };
    gate.resolve();
    await earlier;
    await rejected;
    assert.equal(writes, 1);
    assert.deepEqual(keys, [`provider-session-${boundary}`]);
    assert.equal(
      store.snapshot().data.connectedDevices.length,
      boundary === "queued" ? 0 : 1,
    );
    await assert.rejects(
      local.update((state) => state),
      /Session changed/,
    );
    assert.equal(writes, 1);
  });
}
