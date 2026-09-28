import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../services/api";

const task = {
  id: "task-1",
  plantId: "plant-1",
  title: "Check soil",
  taskType: "WATERING",
  description: "Check before watering",
  status: "COMPLETED",
  urgency: "routine",
  dueDate: "2026-09-28T09:00:00.000Z",
  completedAt: "2026-09-28T09:00:00.000Z",
  createdAt: "2026-09-27T09:00:00.000Z",
  plant: null,
};

test("task mutation cancellation rejects even when transport ignores abort and returns late", async () => {
  let finish!: (response: Response) => void;
  let transportSignal: AbortSignal | null | undefined;
  let calls = 0;
  const api = createApiClient({
    fetch: async (_url, options) => {
      calls++;
      transportSignal = options?.signal;
      assert.equal(options?.method, "PATCH");
      assert.deepEqual(JSON.parse(String(options?.body)), {
        status: "COMPLETED",
      });
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  const controller = new AbortController();
  const pending = api.updateTaskStatus(task.id, "COMPLETED", {
    signal: controller.signal,
  });
  const rejected = assert.rejects(
    pending,
    (error: unknown) => error instanceof ApiError && error.kind === "cancelled",
  );
  controller.abort();
  await rejected;
  assert.equal(transportSignal?.aborted, true);
  finish(new Response(JSON.stringify(task)));
  await Promise.resolve();
  assert.equal(calls, 1);
});

test("already cancelled task mutation never reaches transport", async () => {
  let calls = 0;
  const api = createApiClient({
    fetch: async () => {
      calls++;
      return new Response(JSON.stringify(task));
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    api.updateTaskStatus(task.id, "PENDING", { signal: controller.signal }),
    (error: unknown) => error instanceof ApiError && error.kind === "cancelled",
  );
  assert.equal(calls, 0);
});
