import assert from "node:assert/strict";
import test from "node:test";
import { claimedDevice, deferred, plantId } from "./helpers/device-flow-harness";
import { assignmentHarness, providerHarness, ownedPlant, oldPlant } from "./helpers/device-pairing-harness";
import type { Plant } from "../types";

async function ready(t: { after: (fn: () => void) => void }) {
  const provider = providerHarness();
  t.after(provider.dispose);
  await provider.load();
  provider.claim();
  const screen = assignmentHarness(() => provider.render());
  t.after(screen.dispose);
  return { provider, screen };
}
test("production assignment pairs claimed UUID once, updates reassignment and offers confirmed profile", async (t) => {
  const { provider, screen } = await ready(t);
  const pair = deferred<Plant>();
  provider.behavior.pair = () => pair.promise;
  provider.behavior.fetch = async () => [{ ...ownedPlant, deviceId: claimedDevice.id }, { ...oldPlant, deviceId: undefined }];
  screen.press(); screen.press();
  assert.equal(provider.pairs.length, 1);
  assert.equal(provider.pairs[0].deviceId, claimedDevice.id);
  pair.resolve({ ...ownedPlant, deviceId: claimedDevice.id });
  await screen.settle();
  assert.equal(screen.navigations.length, 1);
  assert.notEqual(screen.tree.type, "Redirect");
  assert.equal(provider.render().pendingDevice, null);
  assert.equal(provider.value.plants.find((plant) => plant.id === oldPlant.id)?.deviceId, undefined);
  const success = assignmentHarness(() => provider.render(), "success");
  t.after(success.dispose);
  assert.match(success.text, /Sensor paired successfully/);
  success.press("View paired plant");
  assert.equal(JSON.stringify(success.navigations[0]), JSON.stringify({ pathname: "/plant-profile", params: { id: plantId } }));
  success.params({ deviceId: claimedDevice.id, targetName: "Forged name" });
  assert.doesNotMatch(success.text, /Forged name/);
});

for (const target of [ { targetType: "space", targetId: "Bedroom" }, { targetType: "plant", targetId: "missing" }, { targetType: "plant", targetId: "mock-leaf-node-01" }, { targetType: ["plant"], targetId: plantId }, { targetId: plantId } ]) {
  test(`production assignment rejects unsupported or missing contextual target ${JSON.stringify(target)}`, async (t) => {
    const { provider, screen } = await ready(t);
    screen.params({ deviceId: claimedDevice.id, ...target });
    screen.press();
    assert.equal(provider.pairs.length, 0);
    assert.match(screen.text, /invalid or no longer available/);
  });
}

test("missing claim, forged UUID and guests cannot mutate", async (t) => {
  const provider = providerHarness(); t.after(provider.dispose); await provider.load();
  const screen = assignmentHarness(() => provider.render()); t.after(screen.dispose);
  assert.equal(screen.tree.type, "Redirect");
  provider.claim(); screen.params({ deviceId: "mock-leaf-node-01", targetType: "plant", targetId: plantId });
  assert.equal(screen.tree.type, "Redirect"); assert.equal(provider.pairs.length, 0);
  const guest = providerHarness({}, true); t.after(guest.dispose);
  await assert.rejects(guest.value.pairClaimedDevice(plantId), /Sign in/);
  assert.equal(guest.pairs.length, 0);
});

test("pair mutation failure remains retryable and refresh failure preserves successful cache and warning", async (t) => {
  const { provider, screen } = await ready(t);
  provider.behavior.pair = async () => { throw new Error("Denied"); };
  screen.press(); await screen.settle();
  assert.match(screen.text, /could not be paired/); assert.equal(screen.navigations.length, 0);
  provider.behavior.pair = async () => ({ ...ownedPlant, deviceId: claimedDevice.id });
  provider.behavior.fetch = async () => { throw new Error("Unavailable"); };
  screen.press(); await screen.settle();
  const state = provider.render();
  assert.equal(provider.pairs.length, 2);
  assert.equal(screen.navigations.length, 1);
  assert.match(state.confirmedPairing?.refreshWarning ?? "", /paired successfully/);
  assert.equal(state.plants.find((plant) => plant.id === oldPlant.id)?.deviceId, undefined);
  assert.equal(state.plants.find((plant) => plant.id === plantId)?.deviceId, claimedDevice.id);
});

for (const boundary of ["account", "unmount", "cancel"] as const) {
  test(`production pairing handles ${boundary} without implying a confirmed write rolled back`, async (t) => {
    const { provider, screen } = await ready(t);
    const pair = deferred<Plant>(); provider.behavior.pair = () => pair.promise;
    const refresh = deferred<Plant[]>(); provider.behavior.fetch = () => refresh.promise;
    screen.press();
    if (boundary === "account") provider.changeAccount();
    if (boundary === "unmount") provider.dispose();
    if (boundary === "cancel") screen.cancel();
    pair.resolve({ ...ownedPlant, deviceId: claimedDevice.id });
    await provider.settle();
    if (boundary === "cancel") {
      assert.equal(provider.value.confirmedPairing?.plant.deviceId, claimedDevice.id);
      assert.equal(provider.value.plants.find((plant) => plant.id === oldPlant.id)?.deviceId, undefined);
    } else assert.equal(provider.value.confirmedPairing, null);
    refresh.resolve([{ ...ownedPlant, deviceId: claimedDevice.id }]);
    await screen.settle();
    assert.equal(screen.navigations.length, 0);
    assert.equal(provider.writesAfterDispose, 0);
  });
}

test("provider rejects unavailable plants and mismatched server confirmation", async (t) => {
  const provider = providerHarness(); t.after(provider.dispose); await provider.load(); provider.claim();
  await assert.rejects(provider.value.pairClaimedDevice("66666666-6666-4666-8666-666666666666"), /available owned plant/);
  assert.equal(provider.pairs.length, 0);
  provider.behavior.pair = async () => ownedPlant;
  await assert.rejects(provider.value.pairClaimedDevice(plantId), /did not confirm/);
  assert.equal(provider.render().confirmedPairing, null);
});


test("confirmed mutation stays on assignment while refresh is pending, then success survives failed refresh", async (t) => {
  const { provider, screen } = await ready(t);
  const refresh = deferred<Plant[]>(); provider.behavior.fetch = () => refresh.promise;
  screen.press(); await screen.settle();
  assert.equal(provider.render().pendingDevice, null);
  assert.equal(provider.value.confirmedPairing?.plant.id, plantId);
  assert.notEqual(screen.tree.type, "Redirect");
  assert.equal(screen.navigations.length, 0);
  screen.press(); assert.equal(provider.pairs.length, 1);
  refresh.reject(new Error("Unavailable")); await screen.settle();
  assert.equal(screen.navigations.length, 1);
  const success = assignmentHarness(() => provider.render(), "success"); t.after(success.dispose);
  assert.match(success.text, /paired successfully/); assert.match(success.text, /could not be refreshed/);
});

test("changing route while mutation runs suppresses the old target handoff", async (t) => {
  const { provider, screen } = await ready(t);
  const pair = deferred<Plant>(); provider.behavior.pair = () => pair.promise;
  screen.press(); screen.params({ deviceId: claimedDevice.id, targetType: "plant", targetId: oldPlant.id });
  pair.resolve({ ...ownedPlant, deviceId: claimedDevice.id }); await screen.settle();
  assert.equal(provider.pairs.length, 1); assert.equal(screen.navigations.length, 0);
  assert.equal(provider.render().confirmedPairing?.plant.id, plantId);
});
