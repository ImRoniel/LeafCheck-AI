import assert from "node:assert/strict";
import { test } from "node:test";
import { persistScan } from "../src/lib/scan-persistence.ts";

test("invalid task payload fails before the transaction is opened", async () => {
  let transactions = 0;
  const client = { $transaction: async () => { transactions++; } };
  for (const tasks of [[], [null], [{ title: "Inspect leaves", taskType: "OTHER", description: "Look for spots", urgency: "routine", dueDate: "invalid" }]]) {
    await assert.rejects(persistScan(client, { output: { subjectKind: "living_plant", healthStatus: "healthy", diagnosticReport: "Report", notification: { notifyAt: "2027-01-01T09:00:00Z", reason: "Follow up" }, careTasks: tasks } }), { code: "SCAN_AI_UNAVAILABLE" });
  }
  assert.equal(transactions, 0);
});

test("nonliving results are refused before opening a transaction", async () => {
  let transactions = 0;
  const client = {$transaction: async () => {transactions++;}};
  for (const subjectKind of ["artificial_plant", "non_plant"]) {
    await assert.rejects(persistScan(client, {output: {subjectKind, healthStatus: "unknown", diagnosticReport: "No biological care needed.", careTasks: [], notification: null}}), {code: "INVALID_INPUT"});
  }
  assert.equal(transactions, 0);
});
