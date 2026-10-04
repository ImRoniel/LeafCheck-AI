import assert from "node:assert/strict";
import test from "node:test";
import { capturedImageBytes, MIN_IMAGE_BYTES, validateCapturedImage } from "../services/pre-scan-coordinator";
import { validatePreScan } from "../services/pre-scan-validation";
import type { CapturedImageMetadata } from "../types/pre-scan-validation";

const image = (bytes = MIN_IMAGE_BYTES, width = 640, height = 480): CapturedImageMetadata => ({
  base64: Buffer.alloc(bytes).toString("base64"), width, height,
});

test("passing image returns exactly the requested contract on every platform", async () => {
  assert.deepEqual(await validatePreScan(image()), { valid: true, reason: "ok", guidance: "" });
  assert.equal(validateCapturedImage(image(MIN_IMAGE_BYTES, 480, 640)).valid, true);
  assert.equal(validateCapturedImage(image(MIN_IMAGE_BYTES, 320, 320)).valid, true);
});

test("uses JPEG bytes rather than base64 length and rejects below the 50 KiB boundary", () => {
  const small = image(MIN_IMAGE_BYTES - 1);
  assert.ok(small.base64!.length > MIN_IMAGE_BYTES);
  const result = validateCapturedImage(small);
  assert.equal(result.valid, false); assert.equal(result.reason, "image_too_small");
  assert.match(result.guidance, /well-lit leaves/);
  assert.equal(validateCapturedImage(image(MIN_IMAGE_BYTES)).valid, true);
});

test("base64 padding is excluded from file size without decoding pixels", () => {
  for (const bytes of [1, 2, 3, MIN_IMAGE_BYTES - 1, MIN_IMAGE_BYTES, MIN_IMAGE_BYTES + 1])
    assert.equal(capturedImageBytes(Buffer.alloc(bytes).toString("base64")), bytes);
});

test("missing and malformed base64 reject instead of failing open", () => {
  for (const base64 of [undefined, null, "", "!!!!", "abc", "AA=A", "AAAA===", "data:image/jpeg;base64,AAAA", 123]) {
    assert.equal(capturedImageBytes(base64), null);
    const result = validateCapturedImage({ ...image(), base64 } as CapturedImageMetadata);
    assert.equal(result.reason, "invalid_image"); assert.equal(result.valid, false);
    assert.ok(result.guidance);
  }
});

test("undersized dimensions reject independently of file size in portrait and landscape", () => {
  for (const [width, height] of [[319, 640], [640, 319]]) {
    const result = validateCapturedImage(image(MIN_IMAGE_BYTES, width, height));
    assert.equal(result.reason, "low_resolution"); assert.match(result.guidance, /higher-resolution/);
  }
});

test("invalid dimension metadata rejects safely", () => {
  for (const value of [0, -1, NaN, Infinity, 320.5, Number.MAX_SAFE_INTEGER + 1, undefined, "640"]) {
    for (const key of ["width", "height"]) {
      const result = validateCapturedImage({ ...image(), [key]: value });
      assert.equal(result.reason, "invalid_image"); assert.equal(result.valid, false);
    }
  }
  assert.equal(validateCapturedImage(null as unknown as CapturedImageMetadata).reason, "invalid_image");
});

test("cancelled session never produces a passing result", async () => {
  const controller = new AbortController(); controller.abort();
  assert.equal((await validatePreScan(image(), controller.signal)).reason, "cancelled");
});
