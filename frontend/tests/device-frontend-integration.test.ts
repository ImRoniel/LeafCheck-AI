import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createApiClient } from "../services/api";
import type { Plant, TelemetryPayload } from "../types";
import type { SessionState } from "../services/session";
import { accountId, claimedDevice, claimHarness, deferred, plantId } from "./helpers/device-flow-harness";
import { assignmentHarness, oldPlant, ownedPlant, providerHarness } from "./helpers/device-pairing-harness";
import { elements, press, profileHarness } from "./helpers/plant-telemetry-harness";

// Real screens, provider and client; controlled HTTP/native boundaries. This
// unit integration is separate from required live Expo evidence.
function server() {
  let plants: Plant[] = [ownedPlant, oldPlant];
  let telemetry: TelemetryPayload | null = null;
  let conflict = false, pairFailure = false, claimed = false;
  const calls: { path: string; method: string; body: unknown }[] = [];
  const api = createApiClient({ baseUrl: "http://integration.test", fetch: async (url, init) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? "GET";
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-access");
    if (path === "/api/plants") return Response.json(plants);
    if (path === "/api/devices/claim") {
      if (conflict) return Response.json({ error: "Already claimed" }, { status: 409 });
      const status = claimed ? 200 : 201;
      claimed = true;
      return Response.json(claimedDevice, { status });
    }
    const matched = path.match(/^\/api\/plants\/([^/]+)\/(pair-device|telemetry)$/);
    assert.ok(matched, `Unexpected route ${path}`);
    const plant = plants.find((item) => item.id === matched[1]);
    assert.ok(plant);
    if (matched[2] === "pair-device") {
      if (pairFailure) return Response.json({ error: "Pair denied" }, { status: 403 });
      assert.deepEqual(body, { deviceId: claimedDevice.id });
      plants = plants.map((item) => item.id === plant.id ? { ...item, deviceId: claimedDevice.id } : item.deviceId === claimedDevice.id ? { ...item, deviceId: undefined } : item);
      return Response.json(plants.find((item) => item.id === plant.id));
    }
    return Response.json(plant.deviceId ? { paired: true, device: claimedDevice, telemetry } : { paired: false, device: null, telemetry: null });
  } });
  const boundary = new AbortController();
  let state: SessionState = { status: "authenticated", user: { id: accountId, email: "fixture@example.test", name: null }, generation: 1, token: "fixture-access", error: null };
  api.bindSession({ snapshot: () => state, signal: () => boundary.signal, refresh: async () => assert.fail("Unexpected refresh"), reject: () => assert.fail("Unexpected rejection") });
  return { api, calls, conflict(value: boolean) { conflict = value; }, pairFailure(value: boolean) { pairFailure = value; }, readings(value: TelemetryPayload) { telemetry = value; } };
}

test("production Scanner -> provider -> Assignment -> Success -> Profile uses UUID and one BFF through real client", async (t) => {
  const backend = server();
  const provider = providerHarness(backend.api); t.after(provider.dispose); await provider.load();
  // Finish the provider's scheduled initial hydration before measuring profile traffic.
  await new Promise<void>((resolve) => setTimeout(resolve, 0)); await provider.settle();
  const scanner = claimHarness(backend.api.claimDevice, { rememberClaimedDevice: (device) => provider.claim(device) }); t.after(scanner.dispose);
  scanner.enter(" lc-a50528 "); scanner.press("Claim device"); await nextTurn(); await scanner.settle();
  assert.equal(provider.render().pendingDevice?.id, claimedDevice.id);
  assert.deepEqual(backend.calls.find((call) => call.path.endsWith("/claim"))?.body, { macAddress: claimedDevice.macAddress });
  const route = scanner.navigations[0] as { params: Record<string, string> };
  const assignment = assignmentHarness(() => provider.render()); t.after(assignment.dispose); assignment.params(route.params);
  assignment.press(); assignment.press(); await nextTurn(); await assignment.settle();
  assert.equal(backend.calls.filter((call) => call.method === "PATCH").length, 1);
  assert.equal(provider.render().plants.find((plant) => plant.id === oldPlant.id)?.deviceId, undefined);
  const success = assignmentHarness(() => provider.render(), "success"); t.after(success.dispose); success.press("View paired plant");
  const destination = success.navigations[0] as { params: { id: string } }; assert.equal(destination.params.id, plantId);
  const profile = profileHarness((id, options) => backend.api.fetchPlantTelemetry(id, options), () => provider.render()); t.after(profile.dispose); profile.target(destination.params.id);
  const before = backend.calls.length; profile.render(); await nextTurn();
  let metrics = profile.renderTelemetry(profile.render()); assert.match(JSON.stringify(metrics), /Waiting for first sensor reading/);
  assert.deepEqual(backend.calls.slice(before).map((call) => call.path), [`/api/plants/${plantId}/telemetry`]);
  backend.readings({ deviceId: claimedDevice.macAddress, timestamp: claimedDevice.updatedAt, environment: { temperatureCelsius: 0, humidityPercentage: 0 }, soilMoisture: { percentage: 0, rawAnalogValue: 0, status: "dry" }, lightLevel: { lux: 0, status: "insufficient" } });
  press(metrics, "Refresh latest reading"); profile.render(); await nextTurn(); metrics = profile.renderTelemetry(profile.render());
  assert.deepEqual(elements(metrics).filter((node) => node.type === "MetricCard").map((node) => node.props.value), [0, 0, 0, 0]);
  assert.doesNotMatch(JSON.stringify(metrics), /TelemetryHistory/);
  press(metrics, "Show reading history"); assert.equal(elements(profile.renderTelemetry(profile.render())).find((node) => node.type === "TelemetryHistory")?.props.deviceId, claimedDevice.macAddress);
  profile.target(oldPlant.id); profile.render(); await nextTurn(); metrics = profile.renderTelemetry(profile.render());
  assert.match(JSON.stringify(metrics), /No sensor paired/);
  press(metrics, "Pair a Sensor"); assert.deepEqual(JSON.parse(JSON.stringify(profile.navigations.at(-1))), { pathname: "/device-connection/scanner", params: { targetType: "plant", targetId: oldPlant.id } });
});

test("real transport preserves claim 409, same-owner reclaim and failed pairing retry", async (t) => {
  const backend = server();
  const provider = providerHarness(backend.api); t.after(provider.dispose); await provider.load();
  const scanner = claimHarness(backend.api.claimDevice, { rememberClaimedDevice: (device) => provider.claim(device) }); t.after(scanner.dispose);
  backend.conflict(true); scanner.scan(claimedDevice.macAddress); await nextTurn(); await scanner.settle();
  assert.match(scanner.text, /belongs to another account/); assert.equal(scanner.navigations.length, 0); assert.equal(provider.render().pendingDevice, null);
  backend.conflict(false); scanner.press("Claim device"); await nextTurn(); await scanner.settle();
  assert.equal(provider.render().pendingDevice?.id, claimedDevice.id);
  const reclaim = claimHarness(backend.api.claimDevice); t.after(reclaim.dispose); reclaim.enter(claimedDevice.macAddress); reclaim.press("Claim device"); await nextTurn(); await reclaim.settle(); assert.equal(reclaim.pendingDevice?.id, claimedDevice.id);
  const assignment = assignmentHarness(() => provider.render()); t.after(assignment.dispose);
  backend.pairFailure(true); assignment.press(); await nextTurn(); await assignment.settle(); assert.equal(assignment.navigations.length, 0); assert.match(assignment.text, /could not be paired/);
  backend.pairFailure(false); assignment.press(); await nextTurn(); await assignment.settle(); assert.equal(assignment.navigations.length, 1);
});

test("late HTTP claim completion after account boundary cannot store a Device or navigate", async (t) => {
  const gate = deferred<Response>(); const boundary = new AbortController();
  const api = createApiClient({ fetch: () => gate.promise });
  let state: SessionState = { status: "authenticated", user: { id: accountId, email: "fixture@example.test", name: null }, generation: 1, token: "fixture-access", error: null };
  api.bindSession({ snapshot: () => state, signal: () => boundary.signal, refresh: async () => {}, reject: () => {} });
  const scanner = claimHarness(api.claimDevice); t.after(scanner.dispose);
  scanner.enter(claimedDevice.macAddress); scanner.press("Claim device");
  state = { ...state, generation: 2, status: "signedOut", user: null, token: null }; boundary.abort(); scanner.auth("signedOut", 2);
  gate.resolve(Response.json(claimedDevice)); await nextTurn(); await scanner.settle();
  assert.equal(scanner.pendingDevice, null); assert.equal(scanner.navigations.length, 0);
});
