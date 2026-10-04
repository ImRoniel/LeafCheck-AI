import assert from "node:assert/strict";
import test from "node:test";
import { chooseProfilePhoto, constrainCrop, cropRectangle, persistProfilePhoto } from "../services/profile-photo";
import { parseLocalState, validProfilePhoto } from "../services/local-state-storage";
import { initialLocalState } from "../types/local-state";

test("crop preview maps portrait, landscape and zoomed edges to square image bounds", () => {
  const portrait = { uri: "photo", width: 1000, height: 2000 };
  assert.deepEqual(cropRectangle(portrait, 250, { zoom: 1, x: 0, y: 0 }), { originX: 0, originY: 500, width: 1000, height: 1000 });
  assert.deepEqual(cropRectangle(portrait, 250, { zoom: 1, x: 999, y: -999 }), { originX: 0, originY: 1000, width: 1000, height: 1000 });
  assert.deepEqual(cropRectangle(portrait, 250, { zoom: 2, x: 0, y: 0 }), { originX: 250, originY: 750, width: 500, height: 500 });
  for (const width of [501, 1000, 2000]) for (const height of [503, 1000, 2000])
    for (const zoom of [0.1, 1, 2, 4, 100]) for (const x of [-999, 0, 999]) {
      const photo = { uri: "photo", width, height };
      const rect = cropRectangle(photo, 233, { zoom, x, y: -x });
      assert.equal(rect.width, rect.height);
      assert.ok(rect.originX >= 0 && rect.originY >= 0);
      assert.ok(rect.originX + rect.width <= width && rect.originY + rect.height <= height);
      const bounded = constrainCrop(photo, 233, { zoom, x, y: -x });
      assert.ok(bounded.zoom >= 1 && bounded.zoom <= 4);
    }
  assert.throws(() => cropRectangle({ ...portrait, width: 0 }, 250, { zoom: 1, x: 0, y: 0 }));
});

test("gallery denial, permanent denial, cancellation and invalid assets do not prepare or save a photo", async () => {
  let launches = 0;
  let preparations = 0;
  const picker = {
    permission: async () => ({ granted: false, canAskAgain: true }),
    launch: async () => { launches++; return { canceled: true, assets: null }; },
    prepare: async (photo: { uri: string; width: number; height: number }) => { preparations++; return photo; },
  };
  await assert.rejects(chooseProfilePhoto(picker), /Allow photo access/);
  await assert.rejects(chooseProfilePhoto({ ...picker, permission: async () => ({ granted: false, canAskAgain: false }) }), /app settings/);
  assert.equal(launches, 0);
  assert.equal(await chooseProfilePhoto({ ...picker, permission: async () => ({ granted: true, canAskAgain: true }) }), null);
  assert.equal(preparations, 0);
  await assert.rejects(chooseProfilePhoto({ ...picker,
    permission: async () => ({ granted: true, canAskAgain: true }),
    launch: async () => ({ canceled: false, assets: [{ uri: "broken", width: 0, height: 100 }] }),
  }), /cannot be opened/);
});

test("gallery selection normalizes the chosen photo before cropping and propagates preparation errors", async () => {
  const photo = { uri: "original", width: 4000, height: 2000 };
  const picker = {
    permission: async () => ({ granted: true, canAskAgain: true }),
    launch: async () => ({ canceled: false, assets: [photo] }),
    prepare: async (asset: typeof photo) => { assert.equal(asset, photo); return { uri: "normalized", width: 1600, height: 800 }; },
  };
  assert.equal((await chooseProfilePhoto(picker))?.uri, "normalized");
  await assert.rejects(chooseProfilePhoto({ ...picker, prepare: async () => { throw new Error("Unsupported image"); } }), /Unsupported image/);
});

test("cropped photos copy to documents before persistence; failed saves preserve the previous avatar", async () => {
  const calls: string[] = [];
  const uri = "file:///app/documents/leafcheck-profile-abc-123.jpg";
  let avatar = "previous";
  const files = {
    copy: async (source: string) => { calls.push(source); return uri; },
    remove: (file: string) => { calls.push(`remove:${file}`); },
  };
  await persistProfilePhoto("cache", files, async saved => { assert.equal(saved, uri); avatar = saved; });
  assert.equal(avatar, uri);
  avatar = "previous";
  await assert.rejects(persistProfilePhoto("cache", files, async () => { throw new Error("Disk full"); }), /Disk full/);
  assert.equal(avatar, "previous");
  assert.ok(calls.includes(`remove:${uri}`));
  await assert.rejects(persistProfilePhoto("cache", { ...files, copy: async () => { throw new Error("Copy failed"); } }, async () => { throw new Error("Must not commit"); }), /Copy failed/);
});

test("local profile validation accepts managed image files and preserves existing URL photos", () => {
  for (const photoUri of ["file:///app/documents/leafcheck-profile-abc-123.jpg", "https://images.test/old.jpg"]) {
    assert.ok(validProfilePhoto(photoUri));
    assert.equal(parseLocalState({ ...initialLocalState(), profile: { photoUri } }).profile?.photoUri, photoUri);
  }
  for (const photoUri of ["file:///private/arbitrary.jpg", "file://remote/documents/leafcheck-profile-a.jpg", "content://library/a", "file:///app/leafcheck-profile-a.jpg?query"]) {
    assert.equal(validProfilePhoto(photoUri), false);
  }
});
