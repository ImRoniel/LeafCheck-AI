import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { frontendRoot } from "./helpers/device-flow-harness";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import * as devices from "../services/device-connection";
import { createLocalStateStore } from "../services/local-state-storage";

const loadModule = createRequire(`${process.cwd()}/package.json`);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
      ts.transpileModule(readFileSync(`${frontendRoot}context/local-state.tsx`, "utf8"), {
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
