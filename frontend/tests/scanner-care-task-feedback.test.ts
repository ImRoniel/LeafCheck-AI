import assert from "node:assert/strict";
import test from "node:test";
import { report, scannerHarness } from "./helpers/scanner-harness";
import type { ScanResponse } from "../types";
import { parseScan } from "../services/validators";

test("sensor-enhanced scan results parse and display raw ADC and lux", async () => {
  const h = scannerHarness();
  const telemetry = { temperature: 32.19, humidity: 76.34, soilMoisture: null,
    soilMoistureRaw: 2625, lightLevel: 0.83, timestamp: "2026-10-12T00:00:00Z" };
  h.behavior.scan = async () => parseScan({ ...report, telemetry });
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, /Sensor-Enhanced AI/);
  assert.match(h.text, /2625 ADC/);
  assert.match(h.text, /0\.83/);
  assert.doesNotMatch(h.text, /2625 %/);
  h.unmount();
});

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

test("diagnostic report can expand and collapse", async () => {
  const h = scannerHarness();
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.ok(h.button("Read More"));
  assert.deepEqual(h.diagnosticLines, [3]);
  h.press("Read More"); assert.ok(h.button("Read Less"));
  assert.deepEqual(h.diagnosticLines, [undefined]);
  h.press("Read Less"); assert.ok(h.button("Read More"));
  assert.deepEqual(h.diagnosticLines, [3]);
  h.unmount();
});

test("unpaired results enter pairing with the saved plant ID", async () => {
  const h = scannerHarness();
  h.behavior.scan = async () => ({...report, plant: {...report.plant!, deviceId: null}});
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  h.press("Pair Sensor");
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigation)), [{pathname: "/device-connection/scanner", params: {targetType: "plant", targetId: report.plant!.id}}]);
  h.unmount();
});

test("paired plants without telemetry do not offer pairing again", async () => {
  const h = scannerHarness();
  h.behavior.scan = async () => ({...report, plant: {...report.plant!, deviceId: "22222222-2222-4222-8222-222222222222"}, telemetry: null});
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.equal(h.button("Pair Sensor"), undefined);
  assert.match(h.text, /Image-Only AI/);
  h.unmount();
});

for (const subjectKind of ["artificial_plant", "non_plant"] as const) {
  test(`${subjectKind} shows information without saving, tasks or pairing`, async () => {
    const h = scannerHarness();
    h.behavior.scan = async () => ({...report, subjectKind, plant: null, identification: null, diagnostic: {...report.diagnostic, healthStatus: "unknown", rawAnalysisText: "No biological care is needed!"}, careTasks: [], notification: null});
    h.ready(); h.press("Capture and scan plant"); await h.settle();
    assert.match(h.text, /INFORMATION/);
    assert.match(h.text, /No biological care is needed/);
    assert.doesNotMatch(h.text, /Plant saved|Upcoming Care Tasks|Next Check-in/);
    assert.equal(h.button("Pair Sensor"), undefined);
    assert.equal(h.stats.refreshes, 0);
    h.unmount();
  });
}

test("photo failure shows a toast while the saved scan stays successful", async () => {
  const h = scannerHarness();
  h.behavior.scan = async () => ({...report, photoSaveFailed: true});
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, /Profile photo could not be saved/);
  assert.match(h.text, /Plant saved/);
  h.unmount();
});
