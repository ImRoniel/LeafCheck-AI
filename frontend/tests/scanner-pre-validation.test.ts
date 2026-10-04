import assert from "node:assert/strict";
import test from "node:test";
import { deferred, picture, scannerHarness } from "./helpers/scanner-harness";
import { validatePreScan } from "../services/pre-scan-validation";
import type { PreScanResult } from "../types/pre-scan-validation";

const pass: PreScanResult = { valid: true, reason: "ok", guidance: "" };

test("scanner waits for validation, locks duplicate taps and submits a passing capture once", async () => {
  const h = scannerHarness();
  const pending = deferred<PreScanResult>();
  h.behavior.validate = () => pending.promise;
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, /Checking your photo/);
  assert.equal(h.requests.length, 0); assert.equal(h.stats.validations, 1);
  pending.resolve(pass); await h.settle();
  assert.equal(h.requests.length, 1); assert.equal(h.flow.getState().phase, "complete");
  h.unmount();
});

for (const reason of ["image_too_small", "low_resolution", "invalid_image", "cancelled"] as const) {
  test(`${reason} never uploads and retake clears feedback`, async () => {
    const h = scannerHarness();
    h.behavior.validate = async () => ({ valid: false, reason, guidance: `Retake: ${reason}` });
    h.ready(); h.press("Capture and scan plant"); await h.settle();
    assert.equal(h.requests.length, 0); assert.match(h.text, /Retake:/);
    assert.equal(h.images.length, 1);
    h.press("Try another photo"); assert.doesNotMatch(h.text, /Retake:/);
    h.behavior.validate = async () => pass;
    h.ready(); h.press("Capture and scan plant"); await h.settle();
    assert.equal(h.requests.length, 1); h.unmount();
  });
}

for (const exit of ["close", "route", "background", "signout", "permission", "unmount"] as const) {
  test(`leaving via ${exit} aborts validation and ignores a late passing result`, async () => {
    const h = scannerHarness(); const pending = deferred<PreScanResult>();
    h.behavior.validate = () => pending.promise;
    h.ready(); h.press("Capture and scan plant"); await h.settle();
    const signal = h.validationSignals[0]; assert.ok(signal);
    if (exit === "close") h.press("Close plant scanner");
    if (exit === "route") h.route("/garden");
    if (exit === "background") h.background("background");
    if (exit === "signout") h.auth("guest");
    if (exit === "permission") h.permission(false);
    if (exit === "unmount") h.unmount();
    assert.equal(signal.aborted, true);
    pending.resolve(pass); await h.settle();
    assert.equal(h.requests.length, 0); assert.equal(h.stats.writesAfterDispose, 0);
    if (exit !== "unmount") h.unmount();
  });
}

test("old validation cannot overwrite or unlock a new capture session", async () => {
  const h = scannerHarness(); const old = deferred<PreScanResult>(); const fresh = deferred<typeof picture>();
  h.behavior.validate = () => old.promise;
  h.ready(); h.press("Capture and scan plant"); await h.settle();
  h.press("Close plant scanner"); h.route("/scanner"); h.behavior.picture = () => fresh.promise;
  h.ready(); const capture = h.button("Capture and scan plant")!.props.onPress as () => void;
  capture(); h.render(); old.resolve(pass); await h.settle(); capture(); h.render();
  assert.equal(h.stats.captures, 2); assert.equal(h.requests.length, 0);
  h.behavior.validate = async () => pass; fresh.resolve(picture); await h.settle();
  assert.equal(h.requests.length, 1); h.unmount();
});

for (const invalid of ["small_file", "small_dimensions", "missing_dimensions"] as const) {
  test(`real JS scanner validator rejects ${invalid} before upload`, async () => {
    const h = scannerHarness();
    h.behavior.validate = validatePreScan;
    h.behavior.picture = async () => ({ uri: "file:///cache/photo.jpg",
      base64: Buffer.alloc(invalid === "small_file" ? 1024 : 60 * 1024).toString("base64"),
      width: invalid === "small_dimensions" ? 100 : invalid === "missing_dimensions" ? undefined : 640,
      height: 480,
    });
    h.ready(); h.press("Capture and scan plant"); await h.settle();
    assert.equal(h.requests.length, 0); assert.ok(h.button("Try another photo"));
    h.press("Try another photo");
    h.behavior.picture = async () => ({ uri: "file:///cache/photo.jpg", width: 640, height: 480,
      base64: Buffer.alloc(60 * 1024).toString("base64") });
    h.ready(); h.press("Capture and scan plant"); await h.settle();
    assert.equal(h.requests.length, 1); assert.equal(h.flow.getState().phase, "complete");
    h.unmount();
  });
}
