import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { geminiError, geminiModel } from "../src/lib/gemini.ts";
import { fetchPlantSpecs } from "../src/lib/perenual.ts";
import { identifyPlant } from "../src/lib/plantnet.ts";

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
    await assert.rejects(identifyPlant("abc"), {
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
  await assert.rejects(identifyPlant("abc"), {
    code: "PLANT_IDENTIFICATION_FAILED",
  });
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => {
    throw new Error("secret URL");
  });
  await assert.rejects(identifyPlant("abc"), {
    code: "PLANT_IDENTIFICATION_FAILED",
  });
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
