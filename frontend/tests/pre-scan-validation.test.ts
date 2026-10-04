import assert from "node:assert/strict";
import test from "node:test";
import { createPreScanValidator, localImagePath, qualityReason, reproductionReason } from "../services/pre-scan-coordinator";
import { validatePreScan } from "../services/pre-scan-validation";

const uri = "file:///cache/plant.jpg";
const good = { isValid: true, isBlurry: false, isDark: false, isWhite: false,
  blurScore: 200, sharpEdgeRatio: 0.1, tenengradScore: 500, meanLuminance: 100,
  stdDevLuminance: 30, overexposedRatio: 0, underexposedRatio: 0 };
const real = { real: 0.98, screen: 0.01, printed_photo: 0.01 };

test("valid captured local image needs both checks and returns exactly the requested shape", async () => {
  const calls: string[] = [];
  const validate = createPreScanValidator({
    analyzeQuality: async path => { calls.push(path); return good; },
    detectReproduction: async path => { calls.push(path); return real; },
  });
  assert.deepEqual(await validate(uri), { valid: true, reason: "ok", guidance: "" });
  assert.deepEqual(calls, [uri, uri]);
});

for (const [flag, reason] of [["isBlurry", "blur"], ["isDark", "underexposed"], ["isWhite", "overexposed"]] as const) {
  test(`quality rejects ${reason} and skips classifier`, async () => {
    let classifications = 0;
    const validate = createPreScanValidator({ analyzeQuality: async () => ({ ...good, [flag]: true, isValid: false }),
      detectReproduction: async () => { classifications++; return real; } });
    const result = await validate(uri);
    assert.equal(result.valid, false); assert.equal(result.reason, reason);
    assert.ok(result.guidance.length > 0); assert.equal(classifications, 0);
  });
}

test("malformed quality values reject and quality precedence is deterministic", () => {
  for (const value of [null, {}, { ...good, blurScore: NaN }, { ...good, meanLuminance: Infinity },
    { ...good, meanLuminance: 256 }, { ...good, isValid: false }, { ...good, isDark: "false" },
    { ...good, overexposedRatio: 2 }]) assert.equal(qualityReason(value), "invalid_image");
  assert.equal(qualityReason({ ...good, isBlurry: true, isDark: true, isWhite: true }), "blur");
  assert.equal(qualityReason({ ...good, isDark: true, isWhite: true }), "underexposed");
});

test("screen/print predictions reject; genuine and uncertain predictions pass", () => {
  assert.equal(reproductionReason({ real: 0.01, screen: 0.98, printed_photo: 0.01 }), "screen");
  assert.equal(reproductionReason({ real: 0.01, screen: 0.01, printed_photo: 0.98 }), "printed_photo");
  assert.equal(reproductionReason({ real: 0.1, screen: 0.8, printed_photo: 0.1 }), "ok");
  assert.equal(reproductionReason(real), "ok");
  for (const value of [null, {}, { ...real, screen: NaN }, { ...real, real: -1 }, { real: 1, screen: 1, printed_photo: 1 }])
    assert.equal(reproductionReason(value), "invalid_image");
});

test("malformed or remote paths never reach native adapters", async () => {
  const validate = createPreScanValidator({ analyzeQuality: async () => { throw new Error("must not run"); }, detectReproduction: async () => real });
  for (const path of ["", "https://example.com/plant.jpg", "data:image/jpeg;base64,x", "file://host/cache/a.jpg",
    "file:///cache/../a.jpg", "file:///cache/%2e%2e/a.jpg", "file:///cache/%00a.jpg", "file:///cache/%GG.jpg"]) {
    assert.equal(localImagePath(path), null);
    assert.equal((await validate(path)).reason, "invalid_image");
  }
  assert.equal(localImagePath("file:///cache/plant%20one.jpg"), "/cache/plant one.jpg");
});

test("native exceptions/unavailable detector reject without exposing diagnostics", async () => {
  const validate = createPreScanValidator({ analyzeQuality: async () => good,
    detectReproduction: async () => { throw new Error("native private path"); } });
  const result = await validate(uri);
  assert.equal(result.reason, "validation_unavailable");
  assert.doesNotMatch(result.guidance, /private path/);
});

test("timeout ignores late native work and prevents overlapping retakes until native settles", async () => {
  let finish!: (value: unknown) => void;
  let calls = 0;
  let semantic = 0;
  const validate = createPreScanValidator({
    analyzeQuality: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    detectReproduction: async () => { semantic++; return real; },
  }, { budgetMs: 10 });
  assert.equal((await validate(uri)).reason, "validation_timeout");
  assert.equal((await validate(uri)).reason, "validation_unavailable");
  assert.equal(calls, 1);
  finish(good); await new Promise(resolve => setImmediate(resolve));
  assert.equal(semantic, 0);
  const next = validate(uri); finish(good);
  assert.equal((await next).reason, "ok"); assert.equal(calls, 2);
});

test("cancelled work skips the next adapter and blocks late results", async () => {
  let finish!: (value: unknown) => void;
  const controller = new AbortController();
  let semantic = 0;
  const validate = createPreScanValidator({ analyzeQuality: () => new Promise(resolve => { finish = resolve; }),
    detectReproduction: async () => { semantic++; return real; } });
  const pending = validate(uri, controller.signal); controller.abort();
  assert.equal((await pending).reason, "cancelled");
  finish(good); await new Promise(resolve => setImmediate(resolve));
  assert.equal(semantic, 0);
  assert.equal((await validate(uri, controller.signal)).reason, "cancelled");
});

test("elapsed-time check catches blocked JS even before the deadline timer runs", async () => {
  let now = 0;
  const validate = createPreScanValidator({ analyzeQuality: async () => { now = 200; return good; },
    detectReproduction: async () => real }, { now: () => now });
  assert.equal((await validate(uri)).reason, "validation_timeout");
});

test("web fallback is explicit unavailability and never imports native checks", async () => {
  const result = await validatePreScan(uri);
  assert.equal(result.valid, false); assert.equal(result.reason, "validation_unavailable");
  assert.match(result.guidance, /Android or iOS/);
});
