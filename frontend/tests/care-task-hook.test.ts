import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { CareTask } from "../types/scan";

const task = (
  id: string,
  status: CareTask["status"] = "PENDING",
): CareTask => ({
  id,
  plantId: "plant-1",
  title: id,
  taskType: "WATERING",
  description: null,
  status,
  urgency: "routine",
  dueDate: "2026-09-28T09:00:00Z",
  completedAt: status === "COMPLETED" ? "2026-09-28T09:00:00Z" : null,
  createdAt: "2026-09-27T09:00:00Z",
  plant: null,
});
type Effect = { deps?: readonly unknown[]; cleanup?: () => void };
type Result = {
  tasks: CareTask[];
  saving: boolean;
  update(id: string, completed: boolean): Promise<void>;
  skip(id: string): Promise<void>;
};

// Execute the actual task and polling hooks with deterministic effect scheduling.
// This is a lifecycle unit harness, not a native rendering/integration test.
function harness() {
  let cursor = 0;
  let dirty = false;
  let disposed = false;
  let focused = true;
  let writesAfterDispose = 0;
  const slots: unknown[] = [];
  const effects: (() => void)[] = [];
  const appListeners = new Set<(state: string) => void>();
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        slots[index],
        (value: unknown) => {
          if (disposed) {
            writesAfterDispose++;
            return;
          }
          const next =
            typeof value === "function" ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) {
            slots[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = cursor++;
      const old = slots[index] as
        | { deps: readonly unknown[]; callback: unknown }
        | undefined;
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i])))
        slots[index] = { deps, callback };
      return (slots[index] as { callback: unknown }).callback;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++;
      const old = slots[index] as Effect | undefined;
      if (
        !old ||
        !deps ||
        deps.some((dep, i) => !Object.is(dep, old.deps?.[i]))
      ) {
        const next: Effect = { deps };
        slots[index] = next;
        effects.push(() => {
          old?.cleanup?.();
          next.cleanup = effect() || undefined;
        });
      }
    },
  };
  const app = {
    currentState: "active",
    addEventListener(_name: string, listener: (state: string) => void) {
      appListeners.add(listener);
      return { remove: () => appListeners.delete(listener) };
    },
  };
  type Poll = {
    stopped: boolean;
    publish(tasks: CareTask[]): Promise<void>;
    fail(): void;
  };
  const polls: Poll[] = [];
  let response: CareTask[] = [];
  const mutations: {
    status: string;
    signal: AbortSignal;
    resolve(value: CareTask): void;
    reject(error: Error): void;
  }[] = [];
  function load(path: string, imports: Record<string, unknown>) {
    const exports: Record<string, unknown> = {};
    runInNewContext(
      ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText,
      {
        exports,
        AbortController,
        require(name: string) {
          if (name in imports) return imports[name];
          throw new Error(`Unexpected import: ${name}`);
        },
      },
    );
    return exports;
  }
  const polling = load("services/use-polling-resource.ts", {
    react,
    "react-native": { AppState: app },
    "../context/auth": { useAuth: () => ({ status: "authenticated" }) },
    "./use-optional-is-focused": { useOptionalIsFocused: () => focused },
    "./errors": { ApiError: Error, asApiError: (error: unknown) => error },
    "./poller": {
      createPoller: (
        loader: (signal: AbortSignal) => Promise<unknown>,
        publish: (value: unknown) => void,
        fail: (error: Error) => void,
      ) => {
        const poll: Poll = {
          stopped: false,
          async publish(tasks) {
            response = tasks;
            const value = await loader(new AbortController().signal);
            if (!poll.stopped) publish(value);
          },
          fail() {
            if (!poll.stopped) fail(new Error("offline"));
          },
        };
        polls.push(poll);
        return {
          start() {},
          stop() {
            poll.stopped = true;
          },
          refresh: () => poll.publish(response),
        };
      },
    },
  });
  const hook = load("hooks/use-care-tasks.ts", {
    react,
    "react-native": { AppState: app },
    "expo-router": {
      useFocusEffect: (effect: () => void | (() => void)) =>
        react.useEffect(
          () => (focused ? effect() : undefined),
          [focused, effect],
        ),
    },
    "@/services/use-polling-resource": polling,
    "@/services/api": {
      api: {
        fetchTasks: async () => response,
        updateTaskStatus: (
          _id: string,
          _status: string,
          options: { signal: AbortSignal },
        ) =>
          new Promise<CareTask>((resolve, reject) =>
            mutations.push({ status: _status, signal: options.signal, resolve, reject }),
          ),
      },
    },
  }).useCareTasks as (enabled: boolean) => Result;
  return {
    render(enabled = true) {
      let result!: Result;
      for (let pass = 0; pass < 20; pass++) {
        cursor = 0;
        dirty = false;
        result = hook(enabled);
        effects.splice(0).forEach((effect) => effect());
        if (!dirty) return result;
      }
      throw new Error("Hook did not settle");
    },
    focus(value: boolean) {
      focused = value;
    },
    background() {
      app.currentState = "background";
      appListeners.forEach((fn) => fn("background"));
    },
    dispose() {
      disposed = true;
      for (const slot of slots) (slot as Effect | undefined)?.cleanup?.();
    },
    polls,
    mutations,
    writesAfterDispose: () => writesAfterDispose,
    listeners: () => appListeners.size,
  };
}

test("task mutation retains the full list and confirmed write when reload fails", async () => {
  const h = harness();
  h.render();
  await h.polls.at(-1)!.publish([task("a"), task("b")]);
  const pending = h.render().update("a", true);
  h.render();
  h.mutations[0].resolve(task("a", "COMPLETED"));
  await pending;
  const result = h.render();
  h.polls.at(-1)!.fail();
  assert.equal(
    result.tasks.length,
    2,
    "unchanged tasks must survive refresh failure",
  );
  assert.equal(
    h.render().tasks.find((item) => item.id === "a")?.status,
    "COMPLETED",
  );
  h.dispose();
});

for (const event of ["blur", "background", "unmount"] as const) {
  test(`task mutation aborts on ${event} and ignores a late success`, async () => {
    const h = harness();
    const pending = h.render().update("a", true);
    h.render();
    if (event === "blur") {
      h.focus(false);
      h.render();
    }
    if (event === "background") {
      h.background();
      h.render();
    }
    if (event === "unmount") h.dispose();
    assert.equal(h.mutations[0].signal.aborted, true);
    h.mutations[0].resolve(task("a", "COMPLETED"));
    await pending;
    if (event !== "unmount") {
      assert.equal(
        h.render().tasks.some((item) => item.status === "COMPLETED"),
        false,
      );
      h.dispose();
    }
    assert.equal(
      h.writesAfterDispose(),
      0,
      "late settlement must not write unmounted state",
    );
    assert.equal(h.listeners(), 0);
  });
}

test("task mutation locks duplicate taps and does not confirm a failed write", async () => {
  const h = harness();
  const result = h.render();
  const pending = result.update("a", true);
  const rejected = assert.rejects(pending, /offline/);
  await result.update("a", true);
  assert.equal(h.mutations.length, 1);
  h.mutations[0].reject(new Error("offline"));
  await rejected;
  assert.equal(h.render().saving, false);
  assert.equal(h.render().tasks.length, 0);
  h.dispose();
});

test("Skip uses SKIPPED only after a successful PATCH and retains previous status on failure", async () => {
  const h = harness();
  h.render();
  await h.polls.at(-1)!.publish([task("a"), task("b")]);
  const pending = h.render().skip("a");
  assert.equal(h.mutations[0].status, "SKIPPED");
  assert.equal(h.render().tasks[0].status, "PENDING");
  h.mutations[0].resolve(task("a", "SKIPPED"));
  await pending;
  assert.equal(h.render().tasks[0].status, "SKIPPED");
  const failed = h.render().skip("b");
  const rejected = assert.rejects(failed, /offline/);
  h.mutations[1].reject(new Error("offline"));
  await rejected;
  assert.equal(h.render().tasks[1].status, "PENDING");
  h.dispose();
});

for (const event of ["blur", "background", "unmount"] as const) {
  test(`Skip aborts on ${event} and ignores a late successful response`, async () => {
    const h = harness();
    h.render();
    await h.polls.at(-1)!.publish([task("a")]);
    const pending = h.render().skip("a");
    h.render();
    if (event === "blur") { h.focus(false); h.render(); }
    if (event === "background") { h.background(); h.render(); }
    if (event === "unmount") h.dispose();
    assert.equal(h.mutations[0].signal.aborted, true);
    h.mutations[0].resolve(task("a", "SKIPPED"));
    await pending;
    if (event !== "unmount") { assert.equal(h.render().tasks[0].status, "PENDING"); h.dispose(); }
    assert.equal(h.writesAfterDispose(), 0);
  });
}

test("disabled account task hook cannot Skip", async () => {
  const h = harness();
  await h.render(false).skip("a");
  assert.equal(h.mutations.length, 0);
  h.dispose();
});
