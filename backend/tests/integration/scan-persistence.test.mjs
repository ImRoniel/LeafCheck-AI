import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "../../src/generated/postgres-client/index.js";
import { persistScan } from "../../src/lib/scan-persistence.ts";
import { reportCareTasks } from "../../src/lib/report-care-tasks.ts";

// Refuse direct execution against application-configured/shared databases.
const url = new URL(process.env.POSTGRES_URL ?? "http://invalid");
if (!/^leafcheck-scan-test-[\da-f-]+$/.test(process.env.LEAFCHECK_SCAN_TEST_CONTAINER ?? "") || url.hostname !== "127.0.0.1" || url.pathname !== "/leafcheck_scan_test") throw new Error("Use the disposable test runner, not an application database.");
const client = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] });
const reader = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] });
const userId = randomUUID();
const outsider = randomUUID();
const now = new Date("2026-10-04T12:00:00Z");
const diagnosticReport = "Healthy plant.\nCare actions:\n- Check soil on 2027-01-01 at 09:00 UTC\n- Inspect leaves on 2027-01-02 at 09:00 UTC";
const input = (plantId) => ({ userId, plantId, name: "Basil", species: "Ocimum basilicum", scanTime: now,
  identification: { speciesName: "Ocimum basilicum", confidence: 0.95, rawResponse: {} },
  output: { healthStatus: "warning", diagnosticReport, careTasks: reportCareTasks(diagnosticReport, now), notification: { notifyAt: "2027-01-03T09:00:00Z", reason: "Review progress" } } });

before(async () => {
  await client.user.createMany({ data: [{ id: userId, email: `${userId}@test.invalid`, password: "unused" }, { id: outsider, email: `${outsider}@test.invalid`, password: "unused" }] });
});
after(async () => { await client.$disconnect(); await reader.$disconnect(); });

const stages = { plant: ["plant", "create"], identification: ["plantIdentification", "create"], analysis: ["aIAnalysis", "create"], tasks: ["careTask", "create"], health: ["plant", "update"] };
function failing(stage) {
  const [model, method] = stages[stage];
  return { $transaction: (operation) => client.$transaction(async (tx) => operation(new Proxy(tx, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (key !== model) return value;
      return new Proxy(value, { get(delegate, operationName) {
        const fn = Reflect.get(delegate, operationName);
        if (operationName !== method) return typeof fn === "function" ? fn.bind(delegate) : fn;
        return async (...args) => { await fn.apply(delegate, args); throw new Error(`injected ${stage} failure after write`); };
      } });
    },
  }))) };
}
async function snapshot() {
  return { plants: await reader.plant.findMany({ orderBy: { id: "asc" } }), identifications: await reader.plantIdentification.findMany({ orderBy: { id: "asc" } }), analyses: await reader.aIAnalysis.findMany({ orderBy: { id: "asc" } }), tasks: await reader.careTask.findMany({ orderBy: { id: "asc" } }) };
}

test("commit persists trusted task links and allows fresh-client reads; rescans preserve history", async () => {
  const saved = await persistScan(client, input());
  const plant = await reader.plant.findUnique({ where: { id: saved.plant.id } });
  assert.equal(plant.healthStatus, "warning");
  assert.equal(plant.lastScannedAt.toISOString(), now.toISOString());
  const analysis = await reader.aIAnalysis.findUnique({ where: { id: saved.analysis.id } });
  assert.equal(analysis.rawAnalysisText, diagnosticReport);
  const tasks = await reader.careTask.findMany({ where: { analysisId: analysis.id } });
  assert.equal(tasks.length, 2);
  for (const task of tasks) {
    assert.equal(task.userId, userId);
    assert.equal(task.plantId, plant.id);
    assert.equal(task.status, "PENDING");
    const returned = saved.careTasks.find((item) => item.title === task.title);
    assert.equal(returned.dueDate, task.dueDate.toISOString());
    assert.equal(returned.description, task.description);
  }
  await client.careTask.update({ where: { id: tasks[0].id }, data: { status: "COMPLETED", completedAt: now } });
  await client.careTask.update({ where: { id: tasks[1].id }, data: { status: "SKIPPED" } });
  const history = await reader.careTask.findMany({ where: { analysisId: analysis.id }, orderBy: { id: "asc" } });
  const rescan = await persistScan(client, input(plant.id));
  assert.equal(await reader.plant.count(), 1);
  assert.notEqual(rescan.analysis.id, analysis.id);
  assert.deepEqual(await reader.careTask.findMany({ where: { analysisId: analysis.id }, orderBy: { id: "asc" } }), history);
});

for (const stage of Object.keys(stages)) test(`actual PostgreSQL rolls back new scan after ${stage} write`, async () => {
  const before = await snapshot();
  await assert.rejects(persistScan(failing(stage), input()), /injected/);
  assert.deepEqual(await snapshot(), before);
});
for (const stage of ["identification", "analysis", "tasks", "health"]) test(`actual PostgreSQL preserves existing plant/history after rescan ${stage} failure`, async () => {
  const plant = await client.plant.findFirst({ where: { userId } });
  const before = await snapshot();
  await assert.rejects(persistScan(failing(stage), { ...input(plant.id), species: "Changed species", scanTime: new Date("2026-10-05T12:00:00Z") }), /injected/);
  assert.deepEqual(await snapshot(), before);
});

test("foreign plant and malformed output cannot write or set task ownership/status", async () => {
  const plant = await client.plant.findFirst({ where: { userId } });
  const before = await snapshot();
  await assert.rejects(persistScan(client, { ...input(plant.id), userId: outsider }), { code: "NOT_FOUND" });
  await assert.rejects(persistScan(client, { ...input(), output: { ...input().output, careTasks: [] } }), { code: "SCAN_AI_UNAVAILABLE" });
  assert.deepEqual(await snapshot(), before);
  const malicious = input(plant.id);
  malicious.output.careTasks[0].userId = outsider;
  malicious.output.careTasks[0].status = "COMPLETED";
  const saved = await persistScan(client, malicious);
  const tasks = await reader.careTask.findMany({ where: { analysisId: saved.analysis.id } });
  assert.ok(tasks.every((item) => item.userId === userId && item.status === "PENDING"));
});
