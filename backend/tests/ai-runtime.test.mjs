import express from "express";
import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

const originalKey = process.env.GEMINI_API_KEY;
let server;
let baseUrl;
let generationError;
const keys = [];
before(async () => {
  mock.module(new URL("../src/lib/auth.js", import.meta.url).href, {
    namedExports: {
      requireAuth: (_req, res, next) => {
        res.locals.auth = { user: { id: "owner" } };
        next();
      },
    },
  });
  mock.module(new URL("../src/lib/ownership.js", import.meta.url).href, {
    namedExports: { ownedPlant: async () => ({}) },
  });
  mock.module("@google/generative-ai", {
    namedExports: {
      GoogleGenerativeAI: class {
        constructor(key) {
          keys.push(key);
        }
        getGenerativeModel() {
          return {
            generateContent: async () => {
              if (generationError) throw generationError;
              return { response: { text: () => "healthy" } };
            },
          };
        }
      },
    },
  });
  delete process.env.GEMINI_API_KEY;
  const { aiRouter } = await import("../src/routes/ai.ts");
  assert.equal(
    keys.length,
    0,
    "import must not create a credential-bound SDK instance",
  );
  const app = express();
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
  mock.restoreAll();
});

test("legacy analysis route recovers from missing config, rotates keys, and sanitizes upstream rejection", async () => {
  const analyze = () =>
    fetch(`${baseUrl}/api/ai/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: "YWJj" }),
    });
  let response = await analyze();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "SCAN_AI_CONFIGURATION");
  process.env.GEMINI_API_KEY = `AIza${"a".repeat(35)}`;
  response = await analyze();
  assert.equal(response.status, 200);
  process.env.GEMINI_API_KEY = `AIza${"b".repeat(35)}`;
  generationError = Object.assign(
    new Error("ACCESS_TOKEN_TYPE_UNSUPPORTED private-key"),
    { status: 401 },
  );
  response = await analyze();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "SCAN_AI_CONFIGURATION");
  assert.doesNotMatch(JSON.stringify(body), /private-key|ACCESS_TOKEN/);
  assert.deepEqual(keys, [`AIza${"a".repeat(35)}`, `AIza${"b".repeat(35)}`]);
});
