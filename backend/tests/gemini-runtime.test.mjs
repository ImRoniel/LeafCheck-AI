import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { geminiError, geminiModel } from "../src/lib/gemini.ts";
import {
  geminiApiKey,
  validateProviderConfig,
} from "../src/lib/provider-config.ts";

const original = { ...process.env };
const keyA = `AIza${"a".repeat(35)}`;
const keyB = `AQ.${"b".repeat(52)}`;
afterEach(() => {
  mock.restoreAll();
  for (const name of ["GEMINI_API_KEY", "GEMINI_MODEL"]) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
});

test("mandatory provider validation rejects malformed credentials without exposing values", () => {
  for (const value of [
    undefined,
    "",
    "Bearer private-token",
    "ya29.private-token",
    "eyJprivate",
    '{"private_key":"secret"}',
    "not-a-google-key",
    `AIza${"a".repeat(34)}`,
    `${keyA}extra`,
    "AQ.",
    "AQ.invalid key",
    "AQ.invalid/key",
    "AQXinvalid-key",
  ]) {
    assert.throws(
      () => geminiApiKey({ GEMINI_API_KEY: value }),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /private-token|private_key|secret|not-a-google-key/,
        );
        return true;
      },
    );
  }
  assert.throws(
    () => geminiApiKey({ GOOGLE_API_KEY: keyA }),
    /GEMINI_API_KEY is required/,
  );
  assert.throws(
    () => validateProviderConfig({ GEMINI_API_KEY: keyA }),
    /PLANTNET_API_KEY/,
  );
  assert.throws(
    () =>
      validateProviderConfig({
        GEMINI_API_KEY: keyA,
        PLANTNET_API_KEY: "two words",
      }),
    /PLANTNET_API_KEY/,
  );
  assert.doesNotThrow(() =>
    validateProviderConfig({
      GEMINI_API_KEY: keyA,
      PLANTNET_API_KEY: "plantnet-test",
    }),
  );
});

test("startup validation and both model modes accept legacy and AQ. keys", () => {
  for (const key of [keyA, keyB, "AQ.short_url-safe-123"]) {
    assert.equal(geminiApiKey({ GEMINI_API_KEY: ` ${key} ` }), key);
    assert.doesNotThrow(() =>
      validateProviderConfig({
        GEMINI_API_KEY: key,
        PLANTNET_API_KEY: "plantnet-test",
      }),
    );
    process.env.GEMINI_API_KEY = key;
    assert.doesNotThrow(() => geminiModel());
    assert.doesNotThrow(() => geminiModel(false));
  }
});

test("real SDK uses current trimmed API key, no bearer header, and configured model on each request", async () => {
  const requests = [];
  mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({
      url: String(url),
      headers: new Headers(options.headers),
      body: JSON.parse(options.body),
    });
    return Response.json({
      candidates: [
        { content: { role: "model", parts: [{ text: "healthy" }] } },
      ],
    });
  });
  process.env.GEMINI_API_KEY = ` ${keyA} `;
  process.env.GEMINI_MODEL = "gemini-2.5-flash";
  await geminiModel().generateContent([
    "diagnose",
    { inlineData: { data: "YWJj", mimeType: "image/jpeg" } },
  ]);
  process.env.GEMINI_API_KEY = keyB;
  process.env.GEMINI_MODEL = "test-model";
  await geminiModel(false).generateContent("diagnose");
  assert.deepEqual(
    requests.map((r) => r.headers.get("x-goog-api-key")),
    [keyA, keyB],
  );
  for (const r of requests) {
    assert.equal(r.headers.has("authorization"), false);
    assert.equal(
      new URL(r.url).origin,
      "https://generativelanguage.googleapis.com",
    );
    assert.equal(new URL(r.url).search, "");
  }
  assert.match(requests[1].url, /models\/test-model:generateContent$/);
  assert.equal(
    requests[0].body.generationConfig.responseMimeType,
    "application/json",
  );
  assert.equal(requests[1].body.generationConfig?.responseMimeType, undefined);
  assert.equal(requests[0].body.contents[0].parts[1].inlineData.data, "YWJj");
  delete process.env.GEMINI_API_KEY;
  assert.throws(geminiModel, { code: "SCAN_AI_CONFIGURATION" });
  assert.equal(requests.length, 2);
});

test("real SDK authentication errors are sanitized rather than retried or returned as user 401s", async () => {
  process.env.GEMINI_API_KEY = keyA;
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: {
          message: "ACCESS_TOKEN_TYPE_UNSUPPORTED private-credential",
          status: "UNAUTHENTICATED",
        },
      },
      { status: 401 },
    ),
  );
  await assert.rejects(
    geminiModel()
      .generateContent("diagnose")
      .catch((error) => {
        throw geminiError(error);
      }),
    {
      status: 503,
      code: "SCAN_AI_CONFIGURATION",
      message:
        "Plant analysis is temporarily unavailable. Please try again later.",
    },
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("server exits cleanly before listening when mandatory configuration is missing or malformed", () => {
  for (const value of ["", "private-invalid-credential"]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx/esm", "src/server.ts"],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { ...process.env, GEMINI_API_KEY: value },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /\[Startup\] Provider configuration error: GEMINI_API_KEY/,
    );
    assert.doesNotMatch(
      result.stderr + result.stdout,
      /private-invalid-credential|Listening on|Error:|at file:/,
    );
  }
});
