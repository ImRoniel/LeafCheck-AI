import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { PlantTelemetry } from "../types";
import { parsePlantTelemetry } from "../services/validators";
import { elements, press, profileHarness, plantId, accountId, testPlant } from "./helpers/plant-telemetry-harness";

const device = { id: "22222222-2222-4222-8222-222222222222", name: "Bedroom sensor", macAddress: "LC-A50528", userId: accountId, status: "ONLINE" as const, createdAt: testPlant.createdAt, updatedAt: testPlant.updatedAt };
const zero = { deviceId: device.macAddress, timestamp: testPlant.createdAt, environment: { temperatureCelsius: 0, humidityPercentage: 0 }, soilMoisture: { percentage: 0, rawAnalogValue: 0, status: "dry" as const }, lightLevel: { lux: 0, status: "insufficient" as const } };
for (const payload of [{ paired: false, device: null, telemetry: null }, { paired: true, device, telemetry: null }, { paired: true, device, telemetry: zero }] as PlantTelemetry[]) {
  test(`production profile renders ${!payload.paired ? "unpaired" : payload.telemetry ? "zero metrics" : "waiting"} from one BFF`, async () => {
    let reads = 0;
    const flow = profileHarness(async () => { reads++; return payload; });
    flow.render();
    assert.match(JSON.stringify(flow.renderTelemetry(flow.render())), /Updating sensor readings/);
    await nextTurn();
    const node = flow.renderTelemetry(flow.render());
    const output = JSON.stringify(node);
    assert.equal(reads, 1); assert.equal(flow.collectionReads(), 0);
    assert.doesNotMatch(output, /TelemetryHistory|local-demo/);
    if (!payload.paired) { assert.match(output, /No sensor paired/); press(node, "Pair a Sensor"); assert.match(JSON.stringify(flow.navigations), new RegExp(plantId)); }
    else {
      assert.match(output, /Bedroom sensor/);
      if (!payload.telemetry) assert.match(output, /Waiting for first sensor reading/);
      else assert.deepEqual(elements(node).filter((child) => child.type === "MetricCard").map((child) => child.props.value), [0, 0, 0, 0]);
      press(node, "Show reading history");
      const history = elements(flow.renderTelemetry(flow.render())).find((child) => child.type === "TelemetryHistory");
      assert.equal(history?.props.deviceId, device.macAddress);
    }
    flow.metadata({ plants: [{ ...testPlant, name: "New name" }] }); flow.render(); assert.equal(reads, 1);
    flow.dispose();
  });
}

test("production profile reports malformed BFF distinctly and retry recovers", async () => {
  let malformed = true;
  const flow = profileHarness(async () => parsePlantTelemetry(malformed ? { paired: true, device: null } : { paired: false, device: null, telemetry: null }));
  flow.render(); await nextTurn();
  let node = flow.renderTelemetry(flow.render());
  assert.doesNotMatch(JSON.stringify(node), /No sensor paired|Waiting for first/);
  press(node, "Retry sensor readings"); malformed = false; flow.render(); await nextTurn();
  node = flow.renderTelemetry(flow.render()); assert.match(JSON.stringify(node), /No sensor paired/); flow.dispose();
});

test("production profile aborts obsolete plant/session responses and refocus observes reassignment", async () => {
  const pending: { signal: AbortSignal; resolve: (value: PlantTelemetry) => void }[] = [];
  const flow = profileHarness((_id, { signal }) => new Promise((resolve) => pending.push({ signal, resolve })));
  flow.render(); await nextTurn(); flow.target(device.id); flow.metadata({ plants: [{ ...testPlant, id: device.id }] }); flow.render(); await nextTurn();
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ paired: true, device, telemetry: zero }); await nextTurn();
  assert.doesNotMatch(JSON.stringify(flow.renderTelemetry(flow.render())), /Bedroom sensor/);
  pending[1].resolve({ paired: true, device, telemetry: zero }); await nextTurn();
  assert.match(JSON.stringify(flow.renderTelemetry(flow.render())), /Bedroom sensor/);
  flow.refocus(); await nextTurn(); pending[2].resolve({ paired: false, device: null, telemetry: null }); await nextTurn();
  assert.match(JSON.stringify(flow.renderTelemetry(flow.render())), /No sensor paired/);
  flow.session(2); flow.render(); await nextTurn(); assert.equal(pending[2].signal.aborted, true); flow.dispose(); assert.equal(pending[3].signal.aborted, true);
});

test("collection hydration, retry, missing metadata and controls use AppData", async () => {
  const flow = profileHarness(async () => ({ paired: false, device: null, telemetry: null }));
  flow.metadata({ loaded: false, plants: [] }); assert.match(JSON.stringify(flow.render()), /Loading plant collection/);
  flow.metadata({ error: "Collection unavailable" }); const failed = flow.render(); press(failed, "Retry plant collection"); assert.equal(flow.collectionReads(), 1);
  flow.metadata({ loaded: true, error: null }); assert.match(JSON.stringify(flow.render()), /Plant not found/);
  flow.metadata({ plants: [testPlant], error: "Refresh failed" }); await nextTurn();
  const node = flow.render(); assert.match(JSON.stringify(node), /Fern species|DeletePlantAction/);
  press(node, "Scan this plant"); press(node, "Edit plant details"); assert.match(JSON.stringify(flow.render()), /EditPlantForm/);
  assert.match(JSON.stringify(flow.navigations), new RegExp(plantId)); flow.dispose();
});

for (const id of [undefined, "", "bad-id", [plantId]]) {
  test(`malformed profile target ${JSON.stringify(id)} is safe`, async () => {
    let reads = 0;
    const flow = profileHarness(async () => { reads++; return { paired: false, device: null, telemetry: null }; });
    flow.target(id); assert.match(JSON.stringify(flow.render()), /Missing or invalid plant ID/);
    await nextTurn(); assert.equal(reads, 0); flow.dispose();
  });
}
test("guest metadata retains scanning and care without BFF reads", async () => {
  let reads = 0;
  const flow = profileHarness(async () => { reads++; return { paired: false, device: null, telemetry: null }; });
  const guestId = "guest-123-fern";
  flow.target(guestId); flow.metadata({ plants: [{ ...testPlant, id: guestId }] });
  flow.session(2, "guest"); const node = flow.render(); await nextTurn();
  assert.doesNotMatch(JSON.stringify(node), /Missing or invalid plant ID/);
  assert.match(JSON.stringify(node), /Sign in to connect a sensor|PlantCareSummary/);
  press(node, "Scan this plant"); assert.equal(reads, 0); flow.dispose();
});
