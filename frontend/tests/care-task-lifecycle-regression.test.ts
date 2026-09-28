import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { CareTask } from "../types/scan";

type Harness = {
  render(): {
    tasks: CareTask[];
    saving: boolean;
    update(id: string, completed: boolean): Promise<void>;
  };
  focus(value: boolean): void;
  dispose(): void;
  polls: {
    stopped: boolean;
    publish(tasks: CareTask[]): Promise<void>;
    fail(): void;
  }[];
  mutations: {
    signal: AbortSignal;
    resolve(task: CareTask): void;
    reject(error: Error): void;
  }[];
  writesAfterDispose(): number;
};

// Reuse the reviewer's actual-hook/actual-polling harness without editing their
// file or registering its tests twice. Only its test-registration import is inert.
const loadModule = createRequire(`${process.cwd()}/package.json`);
const fixture: {
  harness?: () => Harness;
  task?: (id: string, status?: CareTask["status"]) => CareTask;
} = {};
runInNewContext(
  ts.transpileModule(
    `${readFileSync("tests/care-task-hook.test.ts", "utf8")}\nexport { harness, task };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  {
    exports: fixture,
    AbortController,
    require: (name: string) =>
      name === "node:test"
        ? { __esModule: true, default: () => {} }
        : loadModule(name),
  },
);
const harness = fixture.harness!;
const task = fixture.task!;

test("authoritative GET retires confirmed overlays, including after another failed reload", async () => {
  const h = harness();
  h.render();
  await h.polls.at(-1)!.publish([task("a"), task("b")]);
  const first = h.render().update("a", true);
  h.render();
  h.mutations[0].resolve(task("a", "COMPLETED"));
  await first;
  assert.equal(h.render().tasks[0].status, "COMPLETED");
  // Another client changed a back to pending; this newer GET is authoritative.
  await h.polls.at(-1)!.publish([task("a"), task("b")]);
  const second = h.render().update("b", true);
  h.render();
  h.mutations[1].resolve(task("b", "COMPLETED"));
  await second;
  h.render();
  h.polls.at(-1)!.fail();
  const result = h.render();
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks.find((item) => item.id === "a")?.status, "PENDING");
  assert.equal(
    result.tasks.find((item) => item.id === "b")?.status,
    "COMPLETED",
  );
  await h.polls.at(-1)!.publish([]);
  assert.equal(
    h.render().tasks.length,
    0,
    "authoritative deletion must also win",
  );
  h.dispose();
});

test("blur cancellation revalidates before settlement and late finally cannot unlock a newer mutation", async () => {
  const h = harness();
  h.render();
  await h.polls.at(-1)!.publish([task("a"), task("b")]);
  const old = h.render().update("a", true);
  h.render();
  h.focus(false);
  h.render();
  assert.equal(h.mutations[0].signal.aborted, true);
  const pollsBeforeFocus = h.polls.length;
  h.focus(true);
  assert.equal(h.render().saving, false);
  assert.ok(
    h.polls.length > pollsBeforeFocus,
    "focus must revalidate an ambiguous commit",
  );
  await h.polls.at(-1)!.publish([task("a"), task("b")]);
  const current = h.render().update("b", true);
  h.render();
  h.mutations[0].resolve(task("a", "COMPLETED"));
  await old;
  assert.equal(h.render().saving, true);
  await h.render().update("a", true);
  assert.equal(
    h.mutations.length,
    2,
    "old finally must not release the new lock",
  );
  h.mutations[1].resolve(task("b", "COMPLETED"));
  await current;
  const result = h.render();
  assert.equal(result.tasks[0].status, "PENDING");
  assert.equal(result.tasks[1].status, "COMPLETED");
  h.dispose();
  assert.equal(h.writesAfterDispose(), 0);
});

test("a GET published between the synchronous mutation lock and effect cleanup cannot overwrite confirmation", async () => {
  const h = harness();
  h.render();
  await h.polls.at(-1)!.publish([task("a"), task("b")]);
  const oldPoll = h.polls.at(-1)!;
  const pending = h.render().update("a", true);
  // Deliberately do not render: the old poll has not been stopped by effects yet.
  await oldPoll.publish([task("a"), task("b")]);
  h.mutations[0].resolve(task("a", "COMPLETED"));
  await pending;
  const result = h.render();
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].status, "COMPLETED");
  h.dispose();
});
