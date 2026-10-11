import assert from "node:assert/strict";
import test from "node:test";
import { diagnosisPresentation, hasNewerTelemetry, isSensorSetupAction, profileCareTasks } from "../services/plant-profile-guidance";
import type { CareTask } from "../types";

test("re-evaluation compares October telemetry with September diagnosis and tolerates unknown dates", () => {
  const reading = "2026-10-12T00:00:00Z", diagnosis = "2026-09-28T00:00:00Z";
  assert.equal(hasNewerTelemetry(reading, diagnosis), true);
  assert.equal(hasNewerTelemetry(new Date(reading), new Date(diagnosis)), true);
  assert.equal(hasNewerTelemetry(Date.parse(reading), diagnosis), true);
  for (const unknown of [null, undefined, "", "invalid"]) {
    assert.equal(hasNewerTelemetry(reading, unknown), true);
    assert.equal(hasNewerTelemetry(unknown, diagnosis), false);
  }
  assert.equal(hasNewerTelemetry(reading, reading), false);
  assert.equal(hasNewerTelemetry(diagnosis, reading), false);
});

test("setup actions leave the profile care list while sensor maintenance remains", () => {
  const task: CareTask = { id: "a", plantId: "p", title: "Inspect leaves", taskType: "OTHER", description: null, status: "PENDING", urgency: "routine", dueDate: "2026-10-15", completedAt: null, createdAt: "2026-10-11", plant: null };
  const tasks = [task, { ...task, id: "setup", title: "Install Environmental Sensors" }, { ...task, id: "calibration", title: "Calibrate soil sensor", dueDate: "2026-10-12" }];
  assert.deepEqual(profileCareTasks(tasks).map(item => item.id), ["calibration", "a"]);
  assert.equal(tasks.length, 3);
  assert.equal(isSensorSetupAction("Check sensor battery"), false);
});

test("recommendations are extracted from the displayed report without sensor installation", () => {
  const report = diagnosisPresentation("## Diagnosis\nLeaves show browning.\n\n## Care Recommendations\n- Inspect affected leaves.\n- Install Environmental Sensors\n- Move away from direct sun.\n\n## Observations\nNo visible pests.");
  assert.deepEqual(report.recommendations, ["Inspect affected leaves.", "Move away from direct sun."]);
  assert.doesNotMatch(report.text, /Install Environmental Sensors/);
  assert.match(report.text, /No visible pests/);
  assert.deepEqual(diagnosisPresentation("Check the leaves carefully.").recommendations, []);
});
