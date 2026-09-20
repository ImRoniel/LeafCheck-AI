import express from "express";
import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

let server;
let baseUrl;
let scanCalls = 0;
let ttlCalls = 0;
const originalPort = process.env.PORT;

before(async () => {
  process.env.PORT = "0";
  for (const name of ["telemetry", "plants", "ai", "scan"]) {
    const router = express.Router();
    if (name === "scan") {
      router.post("/", (_req, res) => {
        scanCalls++;
        res.status(400).json({ error: "Mock scan validation failure" });
      });
    }
    mock.module(new URL(`../src/routes/${name}.js`, import.meta.url).href, {
      namedExports: { [`${name}Router`]: router },
    });
  }
  mock.module(new URL("../src/lib/ttl.js", import.meta.url).href, {
    namedExports: {
      ensureTTLIndex: async () => {
        ttlCalls++;
      },
    },
  });
  const listen = express.application.listen;
  const listenMock = mock.method(
    express.application,
    "listen",
    function (...args) {
      server = listen.apply(this, args);
      return server;
    },
  );
  const { default: app } = await import("../src/server.ts");
  listenMock.mock.restore();
  assert.equal(app.get("trust proxy"), false);
  if (!server.listening)
    await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (originalPort === undefined) delete process.env.PORT;
  else process.env.PORT = originalPort;
  mock.restoreAll();
});

test("headers, preflight, independent quotas, and rejection before body parsing", async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("x-powered-by"), null);
  assert.ok(health.headers.get("content-security-policy"));
  assert.ok(health.headers.get("ratelimit"));
  assert.equal(health.headers.get("x-ratelimit-limit"), null);
  assert.equal((await health.json()).status, "ok");
  assert.equal(ttlCalls, 1);

  const preflight = await fetch(`${baseUrl}/api/scan`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.test",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

  for (let i = 0; i < 10; i++) {
    const response = await fetch(`${baseUrl}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 400);
    await response.json();
  }
  // Malformed JSON must never reach the parser after the scan quota is used.
  const scanBlocked = await fetch(`${baseUrl}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(scanBlocked.status, 429);
  assert.equal(
    (await scanBlocked.json()).error,
    "Too many scan requests. Please try again later.",
  );
  assert.ok(Number(scanBlocked.headers.get("retry-after")) > 0);
  assert.equal(scanBlocked.headers.get("x-content-type-options"), "nosniff");
  assert.equal(scanBlocked.headers.get("access-control-allow-origin"), "*");
  assert.equal(scanCalls, 10);

  // 12 requests counted globally so far; preflight is handled by CORS.
  for (let i = 0; i < 288; i++) {
    const response = await fetch(`${baseUrl}/missing`);
    assert.equal(response.status, 404);
    await response.json();
  }
  const globalBlocked = await fetch(`${baseUrl}/health`);
  assert.equal(globalBlocked.status, 429);
  assert.equal(
    (await globalBlocked.json()).error,
    "Too many requests. Please try again later.",
  );
  assert.ok(Number(globalBlocked.headers.get("retry-after")) > 0);
  assert.equal(globalBlocked.headers.get("x-content-type-options"), "nosniff");
});
