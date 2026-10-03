import assert from "node:assert/strict";
import test from "node:test";
import { deferred, picture, plant, report, scannerHarness } from "./helpers/scanner-harness";

test("scanner gates capture on readiness and blocks duplicate captures", async () => {
  const h = scannerHarness();
  const pending = deferred<typeof picture>();
  h.behavior.picture = () => pending.promise;
  h.press("Capture and scan plant");
  assert.equal(h.stats.captures, 0);
  h.ready();
  const capture = h.button("Capture and scan plant")!.props.onPress as () => void;
  capture(); capture(); h.render();
  assert.equal(h.stats.captures, 1);
  pending.resolve(picture); await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.flow.getState().phase, "complete");
  assert.match(h.text, /Scan results/);
  assert.equal(h.stats.haptics, 1);
  h.unmount();
});

test("scanner preserves target forwarding and New Scan readiness", async () => {
  const h = scannerHarness();
  h.route("/scanner", { plantId: "flower", deviceId: "sensor" });
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.deepEqual({ ...h.requests[0] }, { imageBase64: picture.base64, plantId: "flower", deviceId: "sensor" });
  h.press("New Scan");
  assert.ok(h.preview);
  assert.equal(h.button("Capture and scan plant")!.props.disabled, true);
  assert.equal(h.flow.getState().phase, "idle");
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.equal(h.requests.length, 2);
  h.unmount();
});

test("missing and oversized camera payloads never reach the scan provider", async () => {
  for (const photo of [{ uri: "memory:invalid" }, { ...picture, base64: "x".repeat(4_000_000) }]) {
    const h = scannerHarness();
    h.behavior.picture = async () => photo;
    h.ready(); h.press("Capture and scan plant"); await h.settle();
    assert.equal(h.requests.length, 0);
    assert.match(h.text, /couldn't finish|too large/);
    h.unmount();
  }
});

test("failed scan can Retake, and Retry Sync preserves diagnosis within the visit", async () => {
  const h = scannerHarness();
  const originalScan = h.behavior.scan;
  h.behavior.scan = async () => { throw new Error("offline"); };
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, /couldn't|couldn’t/);
  h.press("Try another photo");
  assert.ok(h.preview);
  h.behavior.scan = originalScan;
  let patches = 0;
  h.behavior.update = async () => { if (++patches === 1) throw new Error("offline"); return { id: "flower", healthStatus: "healthy" }; };
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.ok(h.flow.getState().report);
  h.press("Retry Sync"); await h.settle();
  assert.equal(h.requests.length, 2);
  assert.equal(patches, 2);
  assert.equal(h.flow.getState().phase, "complete");
  h.unmount();
});

test("guest, permission-denied, unfocused and background states cannot capture", () => {
  const h = scannerHarness();
  h.permission(false);
  assert.equal(h.preview, undefined);
  assert.equal(h.button("Capture and scan plant"), undefined);
  h.permission(true); h.ready(); h.background("background");
  assert.equal(h.preview, undefined);
  assert.equal(h.button("Capture and scan plant")!.props.disabled, true);
  h.background("active"); h.route("/garden");
  assert.equal(h.preview, undefined);
  h.route("/scanner"); h.auth("guest");
  assert.match(h.text, /Sign in to scan/);
  assert.equal(h.preview, undefined);
  h.unmount();
});

test("hook clears reports on route exit but preserves retry state across backgrounding", async () => {
  const h = scannerHarness();
  const pending = deferred<{ id: string; healthStatus: "healthy" }>();
  h.behavior.update = () => pending.promise;
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.ok(h.flow.getState().report);
  h.background("background");
  assert.ok(h.flow.getState().report);
  assert.ok(h.flow.getState().synchronizationError);
  h.background("active");
  h.route("/garden");
  assert.deepEqual(h.flow.getState(), { phase: "idle", report: null, plant: null, error: null, synchronizationError: null });
  pending.resolve({ id: "flower", healthStatus: "healthy" }); await h.settle();
  assert.equal(h.flow.getState().phase, "idle");
  h.unmount();
});

test("hook unmount aborts an outstanding request and drops the transient report", async () => {
  const h = scannerHarness();
  const pending = deferred<Awaited<ReturnType<typeof h.behavior.scan>>>();
  h.behavior.scan = () => pending.promise;
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  h.unmount();
  assert.equal(h.signals[0].aborted, true);
  assert.equal(h.flow.getState().phase, "idle");
  pending.reject(new Error("late failure")); await h.settle();
  assert.equal(h.flow.getState().report, null);
});

test("X clears failed photos and results Back permits three independent scan visits", async () => {
  const h = scannerHarness();
  h.behavior.scan = async () => { throw new Error("unavailable"); };
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.equal(h.images.length, 1);
  h.canGoBack(false); h.press("Close plant scanner");
  assert.deepEqual(h.navigation, ["/(tabs)"]);
  assert.equal(h.images.length, 0);
  assert.equal(h.preview, undefined);
  h.behavior.scan = async () => report;
  for (let i = 0; i < 3; i++) {
    h.route("/scanner");
    assert.ok(h.preview);
    assert.equal(h.images.length, 0);
    assert.equal(h.button("Capture and scan plant")!.props.disabled, true);
    assert.doesNotMatch(h.text, /couldn't|couldn’t|Scan results|Taking your photo/);
    h.ready(); h.press("Capture and scan plant"); await h.settle();
    assert.equal(h.flow.getState().phase, "complete");
    h.canGoBack(true); h.press("Back");
    assert.equal(h.flow.getState().report, null);
    assert.equal(h.flow.getState().plant, null);
    assert.equal(h.preview, undefined);
  }
  assert.equal(h.requests.length, 4);
  assert.ok(h.stats.unmounts >= 4);
  h.unmount();
});

for (const outcome of ["resolve", "reject"] as const) {
  test(`X during capture: late ${outcome} cannot unlock or replace the reopened capture`, async () => {
    const h = scannerHarness();
    const old = deferred<typeof picture>();
    const fresh = deferred<typeof picture>();
    h.behavior.picture = () => old.promise;
    h.ready(); h.press("Capture and scan plant");
    const close = h.button("Close plant scanner")!.props.onPress as () => void;
    close(); close(); h.render();
    assert.equal(h.preview, undefined);
    h.route("/scanner");
    h.behavior.picture = () => fresh.promise;
    h.ready();
    const capture = h.button("Capture and scan plant")!.props.onPress as () => void;
    capture(); h.render();
    if (outcome === "resolve") old.resolve({ ...picture, uri: "memory:old" });
    else old.reject(new Error("old camera error"));
    await h.settle();
    assert.match(h.text, /Taking your photo/);
    assert.equal(h.images.length, 0);
    capture(); h.render();
    assert.equal(h.stats.captures, 2);
    assert.equal(h.requests.length, 0);
    fresh.resolve(picture); await h.settle();
    assert.equal(h.requests.length, 1);
    assert.equal(h.flow.getState().phase, "complete");
    assert.equal(h.stats.haptics, 1);
    assert.equal(h.stats.chimes, 1);
    h.unmount();
  });
}

for (const stage of ["scan", "update", "fetch"] as const) {
  for (const outcome of ["resolve", "reject"] as const) {
    test(`leaving during ${stage}: stale ${outcome} produces no state or feedback in the next visit`, async () => {
      const h = scannerHarness();
      const oldScan = deferred<typeof report>();
      const oldUpdate = deferred<{ id: string; healthStatus: "healthy" }>();
      const oldFetch = deferred<typeof plant>();
      const fresh = deferred<typeof picture>();
      if (stage === "scan") h.behavior.scan = () => oldScan.promise;
      if (stage === "update") h.behavior.update = () => oldUpdate.promise;
      if (stage === "fetch") h.behavior.fetch = () => oldFetch.promise;
      h.ready(); h.press("Capture and scan plant"); await h.settle();
      h.press(stage === "scan" ? "Close plant scanner" : "Back");
      assert.equal(h.signals[0].aborted, true);
      assert.equal(h.flow.getState().phase, "idle");
      h.route("/scanner"); h.behavior.picture = () => fresh.promise;
      h.ready(); const capture = h.button("Capture and scan plant")!.props.onPress as () => void;
      capture(); h.render();
      if (outcome === "reject") {
        (stage === "scan" ? oldScan : stage === "update" ? oldUpdate : oldFetch).reject(new Error("late"));
      } else if (stage === "scan") oldScan.resolve(report);
      else if (stage === "update") oldUpdate.resolve({ id: "flower", healthStatus: "healthy" });
      else oldFetch.resolve(plant);
      await h.settle();
      assert.equal(h.stats.haptics, 0);
      assert.equal(h.stats.chimes, 0);
      assert.equal(h.stats.refreshes, 0);
      assert.match(h.text, /Taking your photo/);
      capture(); h.render();
      assert.equal(h.stats.captures, 2);
      h.behavior.scan = async () => report;
      h.behavior.update = async () => ({ id: "flower", healthStatus: "healthy" });
      h.behavior.fetch = async () => plant;
      fresh.resolve(picture); await h.settle();
      assert.equal(h.flow.getState().phase, "complete");
      assert.equal(h.stats.haptics, 1);
      assert.equal(h.stats.chimes, 1);
      h.unmount();
    });
  }
}

test("old camera callbacks cannot ready or break a new preview; mount/permission recovery works", async () => {
  const h = scannerHarness();
  const oldReady = h.preview!.props.onCameraReady as () => void;
  const oldError = h.preview!.props.onMountError as () => void;
  h.press("Close plant scanner"); h.route("/scanner");
  oldReady(); oldError(); h.render();
  assert.equal(h.button("Capture and scan plant")!.props.disabled, true);
  assert.doesNotMatch(h.text, /couldn’t start/);
  (h.preview!.props.onMountError as () => void)(); h.render();
  assert.match(h.text, /couldn’t start/);
  assert.equal(h.button("Capture and scan plant")!.props.disabled, true);
  h.press("Close plant scanner"); h.route("/scanner");
  h.permission(false); assert.equal(h.preview, undefined);
  h.permission(true); h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.equal(h.flow.getState().phase, "complete");
  h.unmount();
});

test("late permission rejection and unmounted capture cannot write into a later session", async () => {
  const h = scannerHarness();
  h.permission(false);
  const permission = deferred<{ granted: boolean; canAskAgain: boolean }>();
  h.behavior.permission = () => permission.promise;
  h.press("Allow camera"); h.press("Close plant scanner");
  h.route("/scanner"); h.permission(true);
  permission.reject(new Error("old permission failure")); await h.settle();
  assert.doesNotMatch(h.text, /couldn’t open/);
  const photo = deferred<typeof picture>();
  h.behavior.picture = () => photo.promise;
  h.ready(); h.press("Capture and scan plant"); h.unmount();
  photo.resolve(picture); await h.settle();
  assert.equal(h.stats.writesAfterDispose, 0);
  assert.equal(h.requests.length, 0);
});

test("untargeted reentry drops old route context and later targeted entry uses new context", async () => {
  const h = scannerHarness();
  h.route("/scanner", { plantId: "old", deviceId: "old-device" });
  h.press("Close plant scanner"); h.route("/scanner");
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.equal(h.requests[0].plantId, undefined);
  assert.equal(h.requests[0].deviceId, undefined);
  h.press("Back"); h.route("/scanner", { plantId: "flower", deviceId: "new-device" });
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.equal(h.requests[1].plantId, "flower");
  assert.equal(h.requests[1].deviceId, "new-device");
  h.unmount();
});

test("backgrounded capture cannot keep the foreground preview locked", async () => {
  const h = scannerHarness();
  const old = deferred<typeof picture>();
  h.behavior.picture = () => old.promise;
  h.ready(); h.press("Capture and scan plant"); h.background("background");
  h.background("active");
  h.behavior.picture = async () => picture;
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  old.resolve(picture); await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.flow.getState().phase, "complete");
  h.unmount();
});

test("development effect cleanup/setup replay leaves a readyable camera", async () => {
  const h = scannerHarness();
  const oldReady = h.preview!.props.onCameraReady as () => void;
  h.replayEffects();
  oldReady(); h.render();
  assert.equal(h.button("Capture and scan plant")!.props.disabled, true);
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.equal(h.requests.length, 1);
  assert.equal(h.flow.getState().phase, "complete");
  h.unmount();
});

test("late Retry Sync finalizer cannot unlock a newly reopened capture", async () => {
  const h = scannerHarness();
  h.behavior.update = async () => { throw new Error("offline"); };
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  const retry = deferred<{ id: string; healthStatus: "healthy" }>();
  h.behavior.update = () => retry.promise;
  h.press("Retry Sync"); await h.settle();
  h.press("Back"); h.route("/scanner");
  const photo = deferred<typeof picture>();
  h.behavior.picture = () => photo.promise;
  h.ready(); const capture = h.button("Capture and scan plant")!.props.onPress as () => void;
  capture(); h.render();
  retry.resolve({ id: "flower", healthStatus: "healthy" }); await h.settle();
  capture(); h.render();
  assert.equal(h.stats.captures, 2);
  assert.match(h.text, /Taking your photo/);
  h.behavior.update = async () => ({ id: "flower", healthStatus: "healthy" });
  photo.resolve(picture); await h.settle();
  assert.equal(h.flow.getState().phase, "complete");
  h.unmount();
});
