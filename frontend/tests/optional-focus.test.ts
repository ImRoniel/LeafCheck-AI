import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
    createContext,
    createElement,
    useCallback,
    useContext,
    type ReactNode,
} from "react";
import ts from "typescript";

const { renderToString } = require("react-dom/server") as {
  renderToString(node: ReactNode): string;
};

// Isolate React Navigation's native entry point, but render with real React hooks.
function setup() {
  type Navigation = {
    isFocused(): boolean;
    addListener(event: string, callback: () => void): () => void;
  };
  const NavigationContext = createContext<Navigation | undefined>(undefined);
  const NavigationContainerRefContext = createContext<Navigation | undefined>(
    undefined,
  );
  let subscribe!: (callback: () => void) => () => void;
  let getSnapshot!: () => boolean;
  const exports = {} as { useOptionalIsFocused(): boolean };
  const source = readFileSync("services/use-optional-is-focused.ts", "utf8");
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      require(name: string) {
        if (name === "@react-navigation/native") {
          return { NavigationContext, NavigationContainerRefContext };
        }
        if (name === "react") {
          return {
            useCallback,
            useContext,
            useSyncExternalStore(
              onChange: typeof subscribe,
              snapshot: typeof getSnapshot,
            ) {
              subscribe = onChange;
              getSnapshot = snapshot;
              return snapshot();
            },
          };
        }
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  function Probe() {
    return String(exports.useOptionalIsFocused());
  }
  return {
    render(screen?: Navigation, root?: Navigation) {
      return renderToString(
        createElement(
          NavigationContainerRefContext.Provider,
          { value: root },
          createElement(
            NavigationContext.Provider,
            { value: screen },
            createElement(Probe),
          ),
        ),
      );
    },
    subscribe: (callback: () => void) => subscribe(callback),
    snapshot: () => getSnapshot(),
  };
}

test("missing navigation defaults to focused on initial and telemetry re-renders", () => {
  const hook = setup();
  assert.equal(hook.render(), "true");
  assert.doesNotThrow(() => hook.subscribe(() => {})());
  assert.equal(hook.render(), "true");
});

test("navigation focus and blur are observed and both listeners are cleaned up", () => {
  const hook = setup();
  let focused = false;
  const listeners = new Map<string, () => void>();
  const navigation = {
    isFocused: () => focused,
    addListener(event: string, callback: () => void) {
      listeners.set(event, callback);
      return () => {
        listeners.delete(event);
      };
    },
  };
  assert.equal(hook.render(navigation), "false");
  const values: boolean[] = [];
  const cleanup = hook.subscribe(() => values.push(hook.snapshot()));
  focused = true;
  listeners.get("focus")!();
  focused = false;
  listeners.get("blur")!();
  assert.deepEqual(values, [true, false]);
  cleanup();
  assert.equal(listeners.size, 0);
  assert.equal(hook.render(undefined, navigation), "false");
  assert.equal(
    hook.render({ ...navigation, isFocused: () => true }, navigation),
    "true",
  );
  assert.equal(hook.render(), "true");
});
