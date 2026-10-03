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

