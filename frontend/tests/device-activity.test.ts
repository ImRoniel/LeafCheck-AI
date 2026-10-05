import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Unit harness for the actual hook: model focus/state/effect events without a
// native renderer. Reject legacy navigation imports to reproduce the regression.
function activityHarness(platform = "ios", initialState = "active") {
  const exports = {} as { useDeviceActivity(): boolean };
  let focused = true;
  let cursor = 0;
  let mounted = false;
  let routerReads = 0;
  const states: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  const cleanup: (() => void)[] = [];
  const appListeners = new Set<(state: string) => void>();
  const visibilityListeners = new Set<() => void>();
  const document = {
    visibilityState: "visible",
    addEventListener: (_event: string, listener: () => void) =>
      visibilityListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      visibilityListeners.delete(listener),
  };
  const source = readFileSync(new URL("../hooks/use-device-activity.ts", import.meta.url), "utf8");
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      document,
      require(name: string) {
        if (name === "expo-router")
          return {
            useIsFocused: () => {
              routerReads++;
              return focused;
            },
          };
        if (name === "@react-navigation/native")
          throw new Error(
            "Legacy navigation has no provider in this Router stack",
          );
        if (name === "react")
          return {
            useState(initial: unknown) {
              const index = cursor++;
              if (!mounted) states[index] = initial;
              return [
                states[index],
                (value: unknown) => {
                  states[index] = value;
                },
              ];
            },
            useEffect(effect: () => void | (() => void)) {
              if (!mounted) effects.push(effect);
            },
          };
        if (name === "react-native")
          return {
            Platform: { OS: platform },
            AppState: {
              currentState: initialState,
              addEventListener(
                _event: string,
                listener: (state: string) => void,
              ) {
                appListeners.add(listener);
                return { remove: () => appListeners.delete(listener) };
              },
            },
          };
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return {
    render() {
      cursor = 0;
      const result = exports.useDeviceActivity();
      if (!mounted) {
        mounted = true;
        for (const effect of effects) {
          const dispose = effect();
          if (dispose) cleanup.push(dispose);
        }
      }
      return result;
    },
    focus(value: boolean) {
      focused = value;
    },
    appState(value: string) {
      appListeners.forEach((listener) => listener(value));
    },
    visibility(value: string) {
      document.visibilityState = value;
      visibilityListeners.forEach((listener) => listener());
    },
    dispose() {
      cleanup.forEach((dispose) => dispose());
    },
    counts: () => ({
      app: appListeners.size,
      visibility: visibilityListeners.size,
      routerReads,
    }),
  };
}

test("device activity uses Router focus without a standalone navigation provider", () => {
  const hook = activityHarness();
  assert.equal(hook.render(), true);
  hook.focus(false);
  assert.equal(hook.render(), false);
  hook.focus(true);
  assert.equal(hook.render(), true);
  assert.equal(hook.counts().routerReads, 3);
  hook.dispose();
  assert.equal(hook.counts().app, 0);
});

test("device activity stays paused in background or inactive and resumes only when focused", () => {
  const hook = activityHarness("android", "background");
  assert.equal(hook.render(), false);
  hook.appState("active");
  assert.equal(hook.render(), true);
  hook.appState("inactive");
  assert.equal(hook.render(), false);
  hook.focus(false);
  hook.appState("active");
  assert.equal(hook.render(), false);
  hook.dispose();
});

test("web visibility gates device work and both listeners are removed", () => {
  const hook = activityHarness("web");
  assert.equal(hook.render(), true);
  hook.visibility("hidden");
  assert.equal(hook.render(), false);
  hook.visibility("visible");
  assert.equal(hook.render(), true);
  hook.focus(false);
  hook.visibility("visible");
  assert.equal(hook.render(), false);
  assert.equal(hook.counts().visibility, 1);
  hook.dispose();
  assert.equal(hook.counts().app, 0);
  assert.equal(hook.counts().visibility, 0);
});
