import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { ApiError } from "../services/errors";
import { deferred, picture, scannerHarness } from "./helpers/scanner-harness";

function flashlightIcon(button: React.ReactElement<Record<string, unknown>> | undefined) {
  assert.ok(button);
  const icon = React.Children.toArray(button.props.children as React.ReactNode).find(child => React.isValidElement<{ name: string }>(child));
  assert.ok(React.isValidElement<{ name: string }>(icon));
  return icon.props.name;
}

function cameraFlash(h: ReturnType<typeof scannerHarness>): unknown {
  return h.preview?.props.flash;
}

test("flash toggle updates the camera prop, icon and accessibility state without remounting the preview", t => {
  const h = scannerHarness(); t.after(h.unmount);
  assert.equal(h.preview?.props.flash, "off");
  assert.equal(h.button("Turn on flash")?.props.disabled, true);
  h.press("Turn on flash"); assert.equal(h.preview?.props.flash, "off");
  h.ready(); const mounts = h.stats.mounts;
  assert.equal(flashlightIcon(h.button("Turn on flash")), "flashlight-outline");
  h.press("Turn on flash");
  assert.equal(h.preview?.props.flash, "on");
  assert.equal(flashlightIcon(h.button("Turn off flash")), "flashlight");
  assert.equal((h.button("Turn off flash")?.props.accessibilityState as { selected: boolean }).selected, true);
  h.press("Turn off flash");
  assert.equal(h.preview?.props.flash, "off");
  assert.equal(flashlightIcon(h.button("Turn on flash")), "flashlight-outline");
  assert.equal(h.stats.mounts, mounts);
  assert.equal(h.stats.captures, 0);
});

test("capture retains the selected flash, ignores queued toggles while busy and resets it for a new scan", async t => {
  const h = scannerHarness(); t.after(h.unmount);
  const pending = deferred<typeof picture>(); h.behavior.picture = () => pending.promise;
  h.ready(); h.press("Turn on flash");
  const oldToggle = h.button("Turn off flash")!.props.onPress as () => void;
  h.press("Capture and scan plant"); oldToggle(); h.render();
  assert.equal(h.preview?.props.flash, "on");
  assert.equal(h.button("Turn off flash"), undefined);
  pending.resolve(picture); await h.settle();
  assert.equal(h.stats.captures, 1); assert.equal(h.requests.length, 1);
  assert.equal(h.flow.getState().phase, "complete");
  h.press("New Scan"); assert.equal(h.preview?.props.flash, "off");
});

for (const boundary of ["close", "background", "route", "permission", "signout"] as const) {
  test(`flash returns to off after ${boundary} and stale toggle events cannot affect the next preview`, t => {
    const h = scannerHarness(); t.after(h.unmount);
    h.ready(); h.press("Turn on flash");
    const oldToggle = h.button("Turn off flash")!.props.onPress as () => void;
    if (boundary === "close") h.press("Close plant scanner");
    if (boundary === "background") h.background("background");
    if (boundary === "route") h.route("/spaces");
    if (boundary === "permission") h.permission(false);
    if (boundary === "signout") h.auth("guest");
    assert.equal(h.preview, undefined);
    oldToggle(); h.render();
    if (boundary === "background") h.background("active");
    if (boundary === "permission") h.permission(true);
    if (boundary === "signout") h.auth("authenticated");
    if (boundary === "close" || boundary === "route") h.route("/scanner");
    h.ready(); oldToggle(); h.render();
    assert.equal(cameraFlash(h), "off");
  });
}

test("flash controls preserve camera permission and no-plant guidance with photo retry", async t => {
  const h = scannerHarness(); t.after(h.unmount);
  h.permission(false);
  assert.equal(h.button("Turn on flash"), undefined);
  assert.ok(h.button("Allow camera"));
  h.permission(true); h.ready(); h.press("Turn on flash");
  h.behavior.scan = async () => { throw new ApiError("http", "No plant detected", 422, { code: "NO_PLANT_DETECTED" }); };
  h.press("Capture and scan plant"); await h.settle();
  assert.match(h.text, /couldn't quite recognize a plant/);
  assert.ok(h.button("Try another photo"));
  assert.equal(h.button("Turn off flash"), undefined);
  h.press("Try another photo");
  assert.equal(h.preview?.props.flash, "off");
  assert.doesNotMatch(h.text, /couldn't quite recognize a plant/);
  assert.deepEqual(h.navigation, []);
});
