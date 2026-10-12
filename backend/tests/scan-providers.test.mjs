import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { geminiError, geminiModel } from "../src/lib/gemini.ts";
import { fetchPlantSpecs } from "../src/lib/perenual.ts";
import { identifyPlant, preparePlantNetImage, PLANTNET_TIMEOUT_MS, MAX_PLANTNET_IMAGE_BYTES } from "../src/lib/plantnet.ts";

const image = (await sharp({ create: { width: 16, height: 10, channels: 3, background: "green" } }).jpeg().toBuffer()).toString("base64");

const original = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const key of [
    "PLANTNET_API_KEY",
    "PERENUAL_API_KEY",
    "GEMINI_API_KEY",
  ]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

test("Pl@ntNet 404 and empty identification are controlled no-plant outcomes", async () => {
  process.env.PLANTNET_API_KEY = "test";
  for (const [status, body] of [
    [404, { error: "Not Found" }],
    [200, { results: [] }],
    [200, { results: [{ species: {} }] }],
  ]) {
    mock.method(
      globalThis,
      "fetch",
      async () => new Response(JSON.stringify(body), { status }),
    );
    await assert.rejects(identifyPlant(image), {
      status: 422,
      code: "NO_PLANT_DETECTED",
    });
    mock.restoreAll();
  }
});

test("Pl@ntNet unexpected provider error objects and network failures remain controlled", async () => {
  process.env.PLANTNET_API_KEY = "test";
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: { secret: "private" } }), {
        status: 500,
      }),
  );
  await assert.rejects(identifyPlant(image), {
    code: "PLANT_IDENTIFICATION_FAILED",
  });
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => {
    throw new Error("secret URL");
  });
  await assert.rejects(identifyPlant(image), {
    code: "PLANT_IDENTIFICATION_FAILED",
  });
});

test("malformed identification metadata is rejected without returning provider details", async () => {
  process.env.PLANTNET_API_KEY = "test";
  for (const result of [
    { species: { scientificNameWithoutAuthor: 42 }, score: 0.9 },
    { species: { scientificNameWithoutAuthor: "Basil" }, score: "high" },
    { species: { scientificNameWithoutAuthor: "Basil" }, score: 1.1 },
    { species: { scientificNameWithoutAuthor: "Basil", commonNames: [42] }, score: 0.9 },
  ]) {
    mock.method(globalThis, "fetch", async () => Response.json({ results: [result] }));
    await assert.rejects(identifyPlant(image), { status: 502, code: "PLANT_IDENTIFICATION_FAILED" });
    mock.restoreAll();
  }
});

test("Pl@ntNet preparation bounds both image edges and upload size without enlarging small photos", async () => {
  const large = await sharp(randomBytes(2400 * 1200 * 3), { raw: { width: 2400, height: 1200, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  assert.ok(large.length > MAX_PLANTNET_IMAGE_BYTES);
  const resized = await preparePlantNetImage(large.toString("base64"));
  const metadata = await sharp(resized).metadata();
  assert.equal(metadata.width, 1024); assert.equal(metadata.height, 512);
  assert.equal(metadata.format, "jpeg"); assert.ok(resized.length < MAX_PLANTNET_IMAGE_BYTES);
  const small = await sharp(await preparePlantNetImage(image)).metadata();
  assert.equal(small.width, 16); assert.equal(small.height, 10);
});

test("Pl@ntNet sends the prepared JPEG and clears its deadline after a successful response", async t => {
  process.env.PLANTNET_API_KEY = "test";
  let signal, upload;
  mock.method(globalThis, "fetch", async (_url, options) => {
    signal = options.signal; upload = options.body.get("images");
    return Response.json({ results: [{ species: { scientificNameWithoutAuthor: "Ocimum basilicum" }, score: 0.9 }] });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal((await identifyPlant(image)).speciesName, "Ocimum basilicum");
  assert.equal(upload.type, "image/jpeg"); assert.ok(upload.size < MAX_PLANTNET_IMAGE_BYTES);
  assert.equal((await sharp(Buffer.from(await upload.arrayBuffer())).metadata()).format, "jpeg");
  t.mock.timers.tick(PLANTNET_TIMEOUT_MS);
  assert.equal(signal.aborted, false);
});

for (const stage of ["upload", "response parsing"]) {
  test(`Pl@ntNet has a hard 8-second deadline during ${stage}, even when abort is ignored`, async t => {
    process.env.PLANTNET_API_KEY = "test";
    let signal, started;
    const reachedStage = new Promise(resolve => { started = resolve; });
    mock.method(globalThis, "fetch", async (_url, options) => {
      signal = options.signal;
      if (stage === "upload") { started(); return new Promise(() => {}); }
      return { ok: true, json: () => { started(); return new Promise(() => {}); } };
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const attempt = identifyPlant(image);
    await reachedStage;
    t.mock.timers.tick(7999); assert.equal(signal.aborted, false);
    const rejected = assert.rejects(attempt, { status: 504, code: "PLANT_IDENTIFICATION_TIMEOUT" });
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(signal.aborted, true);
  });
}

test("the Pl@ntNet deadline also bounds stalled image preparation and sends no request", async t => {
  process.env.PLANTNET_API_KEY = "test";
  t.mock.method(sharp.prototype, "toBuffer", () => new Promise(() => {}));
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not upload"); });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const attempt = identifyPlant(image);
  const rejected = assert.rejects(attempt, { status: 504, code: "PLANT_IDENTIFICATION_TIMEOUT" });
  t.mock.timers.tick(PLANTNET_TIMEOUT_MS);
  await rejected;
  assert.equal(request.mock.callCount(), 0);
});

test("Pl@ntNet quota and server failures are controlled and missing keys avoid a request", async () => {
  process.env.PLANTNET_API_KEY = "test";
  for (const status of [429, 500]) {
    mock.method(globalThis, "fetch", async () => Response.json({ error: "unavailable" }, { status }));
    await assert.rejects(identifyPlant(image), { code: "PLANT_IDENTIFICATION_FAILED" });
    mock.restoreAll();
  }
  for (const key of [undefined, "", "two words"]) {
    if (key === undefined) delete process.env.PLANTNET_API_KEY;
    else process.env.PLANTNET_API_KEY = key;
    const request = mock.method(globalThis, "fetch", async () => { throw new Error("should not request"); });
    await assert.rejects(identifyPlant(image), { status: 503, code: "PLANT_IDENTIFICATION_FAILED" });
    assert.equal(request.mock.callCount(), 0);
    mock.restoreAll();
  }
});

test("Perenual common-name fallback verifies scientific identity", async () => {
  process.env.PERENUAL_API_KEY = "test";
  const queries = [];
  mock.method(globalThis, "fetch", async (url) => {
    queries.push(new URL(url).searchParams.get("q"));
    return new Response(
      JSON.stringify({
        data:
          queries.length === 1
            ? []
            : [
                { scientific_name: ["Strelitzia reginae"], watering: "wrong" },
                {
                  scientific_name: ["Strelitzia nicolai"],
                  common_name: "White bird of paradise",
                  watering: "Average",
                },
              ],
      }),
    );
  });
  const result = await fetchPlantSpecs(
    "Strelitzia nicolai",
    "White bird of paradise",
  );
  assert.deepEqual(queries, ["Strelitzia nicolai", "White bird of paradise"]);
  assert.equal(result.wateringFrequency, "Average");
});

test("Perenual missing, unrelated, malformed or unavailable data remains optional", async () => {
  process.env.PERENUAL_API_KEY = "test";
  for (const body of [
    { data: [] },
    { data: [{ scientific_name: ["Echeveria elegans"] }] },
    { data: "invalid" },
  ]) {
    mock.method(
      globalThis,
      "fetch",
      async () => new Response(JSON.stringify(body)),
    );
    assert.equal(
      await fetchPlantSpecs("Echeveria colorata", "Mexican giant"),
      null,
    );
    mock.restoreAll();
  }
  mock.method(globalThis, "fetch", async () => {
    throw new Error("timeout");
  });
  assert.equal(await fetchPlantSpecs("Echeveria colorata"), null);
});

test("Gemini configuration is read lazily and rejects missing or OAuth credentials", () => {
  for (const value of ["", "Bearer token", "ya29.oauth", "eyJjwt"]) {
    process.env.GEMINI_API_KEY = value;
    assert.throws(geminiModel, { status: 503, code: "SCAN_AI_CONFIGURATION" });
  }
  process.env.GEMINI_API_KEY = `  AIza${"a".repeat(35)}  `;
  assert.doesNotThrow(geminiModel);
  for (const error of [
    Object.assign(new Error("private URL"), { status: 401 }),
    new Error("ACCESS_TOKEN_TYPE_UNSUPPORTED"),
    new Error("API_KEY_INVALID"),
  ]) {
    const mapped = geminiError(error);
    assert.equal(mapped.code, "SCAN_AI_CONFIGURATION");
    assert.doesNotMatch(mapped.message, /private|TOKEN|KEY/);
  }
  assert.equal(geminiError({ status: 429 }).code, "SCAN_AI_BUSY");
  assert.equal(geminiError(new Error("offline")).code, "SCAN_AI_UNAVAILABLE");
});
