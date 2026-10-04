import assert from "node:assert/strict";
import test from "node:test";
import { report, scannerHarness } from "./helpers/scanner-harness";
import type { ScanResponse } from "../types";

const task: ScanResponse["careTasks"][number] = {
  title: "Check soil moisture",
  taskType: "OTHER",
  description: "Water only if the soil is dry.",
  urgency: "routine",
  dueDate: "2027-01-01T09:00:00Z",
};

for (const count of [1, 2]) test(`saved result shows the actual ${count}-task count and routes to Care Tasks`, async () => {
  const h = scannerHarness();
  h.behavior.scan = async () => ({ ...report, careTasks: Array.from({ length: count }, () => task) });
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, new RegExp(`Plant saved\\. ${count} care ${count === 1 ? "task" : "tasks"} added\\.`));
  assert.match(h.text, /Water only if the soil is dry/);
  assert.equal(h.button("Open Care Tasks")?.props.accessibilityRole, "button");
  h.press("Open Care Tasks");
  assert.deepEqual(h.navigation, ["/(tabs)/tasks"]);
  assert.equal(h.requests.length, 1);
  h.unmount();
});

test("review fallback is counted as one saved task with readable explanation", async () => {
  const h = scannerHarness();
  h.behavior.scan = async () => ({ ...report, careTasks: [{ ...task, title: "Review plant health", description: "Automatic care instructions could not be extracted. Default reminder: 24 hours after the scan." }] });
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, /Plant saved\. 1 care task added\./);
  assert.match(h.text, /Review plant health/);
  assert.match(h.text, /could not be extracted/);
  h.unmount();
});

test("failed synchronization retains tasks without false success; retry never scans again", async () => {
  const h = scannerHarness();
  h.behavior.scan = async () => ({ ...report, careTasks: [task, { ...task, title: "Inspect leaves" }] });
  let patches = 0;
  h.behavior.update = async () => {
    if (++patches === 1) throw new Error("offline");
    return { id: "flower", healthStatus: "healthy" };
  };
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, /Retry Sync/);
  assert.match(h.text, /Inspect leaves/);
  assert.doesNotMatch(h.text, /Plant saved\./);
  assert.equal(h.button("Open Care Tasks"), undefined);
  h.press("Retry Sync"); await h.settle();
  assert.match(h.text, /Plant saved\. 2 care tasks added\./);
  assert.equal(h.requests.length, 1);
  assert.equal(patches, 2);
  h.unmount();
});

test("provider failure cannot display a saved-task result", async () => {
  const h = scannerHarness();
  h.behavior.scan = async () => { throw new Error("scan unavailable"); };
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.doesNotMatch(h.text, /Plant saved\./);
  assert.equal(h.button("Open Care Tasks"), undefined);
  h.unmount();
});
