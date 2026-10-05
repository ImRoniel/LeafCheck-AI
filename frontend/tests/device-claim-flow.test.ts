import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "../types";
import { ApiError } from "../services/errors";
import * as validators from "../services/validators";
import { claimHarness, claimedDevice, deferred, elements, hookHarness, loadProduction, type Element } from "./helpers/device-flow-harness";

test("production scanner coalesces scan/submission and hands off server UUID and target", async () => {
  const flow = claimHarness();
  const gate = deferred<Device>();
  flow.behavior.claim = () => gate.promise;
  flow.scan("LC-A50528");
  flow.scan("LC-A50528");
  flow.press("Claiming…");
  assert.deepEqual(flow.claims, ["LC-A50528"]);
  assert.equal(elements(flow.tree).find((node) => node.type as unknown === "Action" && node.props.label === "Claiming…")?.props.disabled, true);
  gate.resolve(claimedDevice);
  await flow.settle();
  assert.equal(flow.pendingDevice, claimedDevice);
  assert.deepEqual(JSON.parse(JSON.stringify(flow.navigations)), [{ pathname: "/device-connection/assignment", params: { deviceId: claimedDevice.id, targetType: "plant", targetId: "44444444-4444-4444-8444-444444444444" } }]);
  flow.dispose();
});

test("manual input validates visibly, ownership conflict stays and retry succeeds with camera denied", async () => {
  const flow = claimHarness();
  flow.permission(false);
  flow.press("Claim device");
  assert.match(flow.text, /Enter a valid device MAC/);
  assert.equal(flow.claims.length, 0);
  flow.enter("{\"macAddress\":\"LC-A50528\"}");
  flow.press("Claim device");
  assert.equal(flow.claims.length, 0);
  assert.match(flow.text, /Camera access is optional/);
  flow.behavior.claim = async () => { throw new ApiError("http", "conflict", 409); };
  flow.enter("lc-a50528");
  flow.press("Claim device");
  await flow.settle();
  assert.match(flow.text, /belongs to another account/);
  assert.equal(elements(flow.tree).some((node) => node.props.accessibilityRole === "alert"), true);
  assert.equal(flow.navigations.length, 0);
  flow.behavior.claim = async () => claimedDevice;
  flow.press("Claim device");
  await flow.settle();
  assert.equal(flow.claims.length, 2);
  assert.equal(flow.navigations.length, 1);
  flow.dispose();
});

for (const boundary of ["blur", "cancel", "dispose", "auth", "snapshotOnly"] as const) {
  test(`production scanner suppresses pending state and navigation after ${boundary}`, async () => {
    const flow = claimHarness();
    const gate = deferred<Device>();
    flow.behavior.claim = () => gate.promise;
    flow.enter("LC-A50528");
    flow.press("Claim device");
    if (boundary === "auth") flow.auth("authenticated"); else flow[boundary]();
    if (boundary !== "snapshotOnly") assert.equal(flow.signals[0].aborted, true);
    gate.resolve(claimedDevice);
    if (boundary === "dispose") for (let i = 0; i < 10; i++) await Promise.resolve();
    else await flow.settle();
    assert.equal(flow.pendingDevice, null);
    assert.equal(flow.navigations.length, 0);
    assert.equal(flow.writesAfterDispose, 0);
    flow.dispose();
  });
}

test("guest scanner offers sign-in without claim or camera access", () => {
  const flow = claimHarness();
  flow.auth("guest");
  assert.match(flow.text, /Manual plant care and image scanning remain available/);
  assert.equal(elements(flow.tree).some((node) => node.type as unknown === "TextInput"), false);
  flow.scan("LC-A50528");
  assert.equal(flow.claims.length, 0);
  flow.press("Sign in");
  assert.deepEqual(flow.navigations, ["/login"]);
  flow.dispose();
});

test("legacy selection bypasses mock nodes and retains contextual target", () => {
  const module = loadProduction("app/device-connection/selection.tsx", {
    "expo-router": { Redirect: "Redirect", useLocalSearchParams: () => ({ targetType: "plant", targetId: "44444444-4444-4444-8444-444444444444" }) },
  });
  const node = (module.default as () => Element)();
  assert.deepEqual(JSON.parse(JSON.stringify(node.props.href)), { pathname: "/device-connection/scanner", params: { targetType: "plant", targetId: "44444444-4444-4444-8444-444444444444" } });
});

test("production AppData fences old claim closure and clears ephemeral Device on account remount", () => {
  let auth = { status: "authenticated", generation: 1, isGuest: false, user: { id: "11111111-1111-4111-8111-111111111111" } };
  let snapshot = auth;
  const create = () => {
    const hooks = hookHarness();
    const module = loadProduction("context/app-data.tsx", {
      react: hooks.hooks,
      "@/services/api": {},
      "@/services/validators": validators,
      "@react-native-async-storage/async-storage": { getItem: async () => null },
      "./auth": { useAuth: () => auth, session: { snapshot: () => snapshot } },
      "./local-state": { useLocalState: () => ({ data: { guestPlants: [] }, ready: true }) },
    });
    const wrapper = module.AppDataProvider as (props: object) => Element;
    const shell = wrapper({ children: null });
    const component = shell.type as (props: object) => Element;
    const render = () => hooks.render(() => component({ children: null })).props.value as {
      pendingDevice: Device | null; rememberClaimedDevice(device: Device): void;
    };
    return { render, shell, dispose: hooks.dispose };
  };
  const account = create();
  const old = account.render();
  old.rememberClaimedDevice(claimedDevice);
  assert.equal(account.render().pendingDevice, claimedDevice);
  snapshot = { ...auth, status: "anonymous", generation: 2 };
  assert.throws(() => old.rememberClaimedDevice(claimedDevice), /Session changed/);
  account.dispose();
  auth = { ...auth, generation: 3, user: { id: "22222222-2222-4222-8222-222222222222" } };
  snapshot = auth;
  const next = create();
  assert.notEqual(account.shell.key, next.shell.key);
  assert.equal(next.render().pendingDevice, null);
  assert.throws(() => next.render().rememberClaimedDevice(claimedDevice), /Sign in to claim/);
  next.dispose();
});

test("permission rejection after unmount never writes screen state", async () => {
  const flow = claimHarness();
  const gate = deferred<{ granted: boolean; canAskAgain: boolean }>();
  flow.behavior.permission = () => gate.promise;
  flow.permission(false, true);
  flow.press("Allow camera scanning");
  flow.dispose();
  gate.reject(new Error("denied"));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(flow.writesAfterDispose, 0);
});

test("nonconflict claim error is sanitized and scanned retry remains usable", async () => {
  const flow = claimHarness();
  flow.behavior.claim = async () => { throw new Error("EXPO_PUBLIC_API_URL localhost failed to fetch"); };
  flow.scan("LC-A50528");
  await flow.settle();
  assert.match(flow.text, /Unable to connect to the server/);
  assert.doesNotMatch(flow.text, /EXPO_PUBLIC_API_URL|localhost/);
  assert.equal(flow.navigations.length, 0);
  flow.press("Scan again");
  flow.behavior.claim = async () => claimedDevice;
  flow.scan("LC-A50528");
  await flow.settle();
  assert.equal(flow.claims.length, 2);
  assert.equal(flow.navigations.length, 1);
  flow.dispose();
});
