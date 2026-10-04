import assert from "node:assert/strict";
import { test } from "node:test";
import { NaturalLanguageParserCore } from "tasknotes-nlp-core";
import { reportCareTasks } from "../src/lib/report-care-tasks.ts";
import { validateScanOutput } from "../src/lib/scan-output.ts";

const now = new Date("2026-10-04T23:30:00.000Z");
const report = (...lines) => `Health assessment\n- Disease is possible.\n\n## Care actions\n${lines.join("\n")}\n\n## Environment\n- Water without checking soil.`;

test("pinned library ESM parses task title and date; adapter extracts only action bullets", () => {
  const parser = new NaturalLanguageParserCore([], [], false, "en", { triggers: [] });
  assert.equal(parser.parseInput("Inspect leaves on 2027-01-01").title, "Inspect leaves");
  const tasks = reportCareTasks(report("- Inspect leaves on 2027-01-01 at 09:00 UTC", "2. Water only if the soil is dry on 2027-01-02 at 10:00 UTC"), now);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "Inspect leaves");
  assert.equal(tasks[0].dueDate, "2027-01-01T09:00:00.000Z");
  assert.match(tasks[1].title, /only if the soil is dry/);
  assert.equal(tasks[1].taskType, "WATERING");
  assert.equal(tasks[1].dueDate, "2027-01-02T10:00:00.000Z");
  validateScanOutput({ healthStatus: "healthy", diagnosticReport: "Saved report", careTasks: tasks, notification: { notifyAt: "2027-01-01T10:00:00Z", reason: "Follow up" } });
});

test("missing, repeated, empty and unusable sections use a bounded review fallback", () => {
  for (const input of ["Healthy plant", "Care actions:\n", report("- Soil looks dry"), "Care actions\n- Inspect leaves\nCare actions\n- Check soil", report(`- Inspect ${"x".repeat(5000)}`), report(`- Inspect ${"x".repeat(210)}`)]) {
    const tasks = reportCareTasks(input, now);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "Review plant health");
    assert.equal(tasks[0].dueDate, "2026-10-05T23:30:00.000Z");
    assert.match(tasks[0].description, /could not be extracted/);
  }
  for (const input of [null, {}, "", "x".repeat(50001)]) assert.throws(() => reportCareTasks(input, now), { code: "SCAN_AI_UNAVAILABLE" });
  assert.throws(() => reportCareTasks("report", new Date("invalid")));
});

test("bullets, continuation details, deduplication and five-task limit preserve report order", () => {
  const tasks = reportCareTasks(report("* Inspect leaves", "  Look under each leaf.", "• Inspect leaves Look under each leaf.", ...Array.from({ length: 8 }, (_, i) => `- Check plant ${i}`)), now);
  assert.equal(tasks.length, 5);
  assert.match(tasks[0].description, /Look under each leaf/);
  assert.match(tasks[4].title, /plant 3/);
});

test("absolute dates and default reminders ignore ambient timezone and relative clock", () => {
  for (const [suffix, expected] of [
    ["on 2027-01-01", "2027-01-01T09:00:00.000Z"],
    ["on 2026-10-05 at 00:00 UTC", "2026-10-05T00:00:00.000Z"],
    ["on 2027-01-01T12:34:56Z", "2027-01-01T12:34:56.000Z"],
    ["on 2027-01-01 at 09:00 UTC only if dry", "2027-01-01T09:00:00.000Z"],
  ]) assert.equal(reportCareTasks(report(`- Check soil ${suffix}`), now)[0].dueDate, expected);
  for (const suffix of ["", "tomorrow", "on 11/06/2026", "on 2026-02-30", "on 2026-10-01", "on 2027-01-01 at 29:00 UTC", "on 2027-01-01T09:00:00+08:00", "on 2027-01-01 at 09:00 PM", "on 2027-01-01 at 09:00 PDT", "on 2027-01-01 at 09:00 CET", "on 2027-01-01 at 09:00 +0800", "on 2027-01-01 at 09:00 UTC+8", "on 2027-01-01 at 09:00 Europe/Paris", "on 2027-01-01 at 09:00:30 UTC", "every week", "on 2027-01-01 or 2027-01-02"]) {
    const task = reportCareTasks(report(`- Check soil ${suffix}`), now)[0];
    assert.equal(task.dueDate, "2026-10-05T23:30:00.000Z", suffix);
    assert.match(task.description, /Default reminder/);
  }
});

test("conditional and negative instructions retain their meaning and cannot control persistence", () => {
  const tasks = reportCareTasks(report("- Do not fertilize until the roots recover", "- Water only if dry. Urgency: urgent", "- Check roots #admin @owner +project *done every week"), now);
  assert.equal(tasks[0].taskType, "OTHER");
  assert.match(tasks[0].title, /^Do not fertilize/);
  assert.match(tasks[1].description, /only if dry/);
  assert.equal(tasks[1].urgency, "urgent");
  assert.equal(tasks[2].urgency, "routine");
  assert.equal(tasks[2].taskType, "OTHER");
  for (const task of tasks) {
    assert.equal(task.status, undefined);
    assert.equal(task.userId, undefined);
    assert.equal(task.recurrence, undefined);
  }
});
