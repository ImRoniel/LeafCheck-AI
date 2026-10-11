import assert from "node:assert/strict";
import { afterEach, before, beforeEach, mock, test } from "node:test";

const credentialNames = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
const original = Object.fromEntries(credentialNames.map(name => [name, process.env[name]]));
let uploadCalls, deleteCalls, rejectUpload, rejectDelete, uploadResponse, storeScanImage, discardScanImage;
before(async () => {
  mock.module("cloudinary", {namedExports: {v2: {uploader: {
    upload: async (image, options) => {
      uploadCalls.push({image, options});
      if (rejectUpload) throw new Error("private provider secret");
      return uploadResponse;
    },
    destroy: async (publicId, options) => {
      deleteCalls.push({publicId, options});
      if (rejectDelete) throw new Error("private cleanup secret");
      return {result: "ok"};
    },
  }}}});
  ({storeScanImage, discardScanImage} = await import("../src/lib/scan-image-storage.ts"));
});
beforeEach(() => {
  uploadCalls = []; deleteCalls = []; rejectUpload = false; rejectDelete = false;
  uploadResponse = {secure_url: "https://res.cloudinary.com/test/image/upload/plant.jpg", public_id: "plant-photos/owner/test"};
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
});
afterEach(() => {
  mock.restoreAll();
  for (const name of credentialNames) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});
for (const name of credentialNames) {
  test(`missing ${name} saves a displayable JPEG data URL without an upload`, async () => {
    delete process.env[name];
    const image = await storeScanImage("/9j/2Q==", "owner");
    assert.equal(image.imageUrl, "data:image/jpeg;base64,/9j/2Q==");
    await discardScanImage(image);
    assert.equal(uploadCalls.length, 0); assert.equal(deleteCalls.length, 0);
  });
}
test("Cloudinary receives base64 JPEG and explicit server credentials and returns secure_url", async () => {
  const image = await storeScanImage("/9j/2Q==", "owner");
  assert.equal(uploadCalls[0].image, "data:image/jpeg;base64,/9j/2Q==");
  assert.match(uploadCalls[0].options.public_id, /^plant-photos\/owner\/.+/);
  assert.equal(uploadCalls[0].options.cloud_name, "test-cloud");
  assert.equal(uploadCalls[0].options.api_key, "test-key");
  assert.equal(uploadCalls[0].options.api_secret, "test-secret");
  assert.equal(uploadCalls[0].options.resource_type, "image");
  assert.equal(uploadCalls[0].options.overwrite, false);
  assert.equal(image.imageUrl, uploadResponse.secure_url);
  assert.equal(image.cloudinaryPublicId, uploadResponse.public_id);
  await discardScanImage(image);
  assert.equal(deleteCalls[0].publicId, uploadResponse.public_id);
  assert.equal(deleteCalls[0].options.invalidate, true);
});
test("upload failure returns fallback data and a toast flag without leaking provider secrets", async () => {
  rejectUpload = true;
  const log = mock.method(console, "error", () => {});
  const image = await storeScanImage("/9j/2Q==", "owner");
  assert.equal(image.imageUrl, "data:image/jpeg;base64,/9j/2Q==");
  assert.equal(image.uploadFailed, true);
  assert.equal(image.cloudinaryPublicId, undefined);
  assert.doesNotMatch(JSON.stringify(log.mock.calls.map(call => call.arguments)), /private provider secret|test-secret/);
  await discardScanImage(image); assert.equal(deleteCalls.length, 0);
});
test("an insecure upload URL is replaced with fallback data", async () => {
  uploadResponse.secure_url = "http://example.com/insecure.jpg";
  mock.method(console, "error", () => {});
  const image = await storeScanImage("/9j/2Q==", "owner");
  assert.equal(image.imageUrl, "data:image/jpeg;base64,/9j/2Q==");
  assert.equal(image.uploadFailed, true);
  assert.equal(deleteCalls[0].publicId, uploadResponse.public_id);
});
test("cleanup failures remain sanitized and do not mask a failed scan transaction", async () => {
  rejectDelete = true;
  const log = mock.method(console, "error", () => {});
  await discardScanImage({imageUrl: "https://example.com/plant.jpg", cloudinaryPublicId: "plant-photos/owner/test"});
  assert.doesNotMatch(JSON.stringify(log.mock.calls.map(call => call.arguments)), /private cleanup secret/);
});
