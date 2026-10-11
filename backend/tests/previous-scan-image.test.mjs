import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { previousScanImage } from "../src/lib/previous-scan-image.ts";
import { MAX_SCAN_IMAGE_BYTES } from "../src/lib/scan-input.ts";

afterEach(() => mock.restoreAll());
test("saved JPEG data URLs reuse the original bytes without a network request", async () => {
  const fetch = mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  assert.equal(await previousScanImage("data:image/jpeg;base64,/9j/2Q=="), "/9j/2Q==");
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(previousScanImage(null), { code: "NO_SAVED_IMAGE" });
  await assert.rejects(previousScanImage("data:image/jpeg;base64,invalid"), { code: "INVALID_IMAGE" });
});
test("Cloudinary JPEGs download with a timeout and redirects disabled", async () => {
  mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.hostname, "res.cloudinary.com");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(Buffer.from("/9j/2Q==", "base64"));
  });
  assert.equal(await previousScanImage("https://res.cloudinary.com/leafcheck/image/upload/photo.jpg"), "/9j/2Q==");
});
test("unsupported origins and protocols stop before any fetch", async () => {
  const fetch = mock.method(globalThis, "fetch", () => { throw new Error("Unexpected fetch"); });
  for (const url of ["http://127.0.0.1/photo", "https://example.com/photo", "https://res.cloudinary.com.evil.test/photo", "https://user:password@res.cloudinary.com/photo"]) {
    await assert.rejects(previousScanImage(url), { code: "SAVED_IMAGE_UNAVAILABLE" });
  }
  assert.equal(fetch.mock.callCount(), 0);
});
test("download failures, invalid image bytes and oversized responses return a sanitized error", async () => {
  const fetch = mock.method(globalThis, "fetch", async () => new Response("missing", { status: 404 }));
  const url = "https://res.cloudinary.com/leafcheck/image/upload/photo.jpg";
  await assert.rejects(previousScanImage(url), { code: "SAVED_IMAGE_UNAVAILABLE" });
  fetch.mock.mockImplementation(async () => new Response("not jpeg"));
  await assert.rejects(previousScanImage(url), { code: "SAVED_IMAGE_UNAVAILABLE" });
  fetch.mock.mockImplementation(async () => new Response(new Uint8Array(MAX_SCAN_IMAGE_BYTES + 1)));
  await assert.rejects(previousScanImage(url), { code: "SAVED_IMAGE_UNAVAILABLE" });
  fetch.mock.mockImplementation(async () => { throw new Error("private download token"); });
  await assert.rejects(previousScanImage(url), error => error.code === "SAVED_IMAGE_UNAVAILABLE" && !error.message.includes("private"));
});
