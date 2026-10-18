import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { after, before, mock, test } from "node:test";
import express from "express";
import { adminSessionFixture } from "./helpers/admin-session-fixture.mjs";

const origin = "http://localhost:5174";
Object.assign(process.env, {
  NODE_ENV: "production", AUTH_ALLOW_LOCAL_ADMIN_ORIGIN: "true", AUTH_PROVIDER: "supabase", PORT: "0",
  AUTH_JWT_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM",
  AUTH_JWT_ISSUER: "proxy-test", AUTH_JWT_AUDIENCE: "proxy-test",
  AUTH_ALLOWED_ORIGINS: ` ${origin} `, VITE_API_URL: "/api",
});
const actors = new Map(["ADMIN", "LEAD_DEV", "USER"].map(role => {
  const id = randomUUID();
  return [id, { id, role, email: `${role.toLowerCase()}@example.test`, name: role,
    isActive: true, createdAt: new Date(), updatedAt: new Date() }];
}));
let server, vite, backendUrl, proxyUrl, api, accessToken;
let inventoryReads = 0;
const seen = [];
const network = globalThis.fetch;
const db = {
  adminSessionVerification: { findUnique: async ({ where }) => {
    const user = actors.get(where.supabaseSessionId);
    return user?.role === "ADMIN" ? { userId: user.id, verifiedAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 60_000), authVersion: 0 } : null;
  } },
  authSession: { findUnique: async ({ where }) => {
    const user = actors.get(where.id);
    return user ? { id: where.id, userId: user.id, user, revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000) } : null;
  } },
  user: {
    findMany: async () => { inventoryReads++; return [...actors.values()].map(user => ({
      ...user, _count: { plants: 0, devices: 0, careTasks: 0 },
    })); },
    count: async () => actors.size,
  },
  $transaction: callback => callback(db),
};

before(async () => {
  mock.module(new URL("../src/lib/supabase-session.js", import.meta.url).href, { namedExports:
    adminSessionFixture(id => db.authSession.findUnique({ where: { id } })) });
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: db } });
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: {} } });
  mock.module(new URL("../src/lib/provider-startup.js", import.meta.url).href, { namedExports: {} });
  mock.module(new URL("../src/lib/ttl.js", import.meta.url).href, { namedExports: { ensureTTLIndex: async () => {} } });
  for (const name of ["telemetry", "plants", "devices", "ai", "scan", "auth", "users"]) {
    const router = express.Router();
    if (name === "auth") router.post("/proxy-probe", (req, res) => {
      res.cookie("__Host-proxy-probe", "rotated", { httpOnly: true, secure: true, sameSite: "strict", path: "/" });
      res.json({ cookie: req.get("cookie"), authorization: req.get("authorization"),
        origin: req.get("origin"), csrf: req.get("x-csrf-protection") });
    });
    mock.module(new URL(`../src/routes/${name}.js`, import.meta.url).href, { namedExports: { [`${name}Router`]: router } });
  }
  const listen = express.application.listen;
  const intercept = mock.method(express.application, "listen", function (...args) {
    server = listen.apply(this, args);
    return server;
  });
  await import("../src/server.ts");
  intercept.mock.restore();
  if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
  server.on("request", req => seen.push({ url: req.url, headers: req.headers }));
  backendUrl = `http://127.0.0.1:${server.address().port}`;
  ({ accessToken } = await import("../src/lib/auth.ts"));

  process.env.API_PROXY_TARGET = backendUrl;
  const { default: configure } = await import("../../admin-web/vite.config.ts");
  const config = configure({ mode: "development", command: "serve" });
  assert.equal(config.server.port, 5174);
  assert.equal(config.server.strictPort, true);
  const adminRequire = createRequire(new URL("../../admin-web/package.json", import.meta.url));
  const { createServer } = await import(adminRequire.resolve("vite"));
  vite = await createServer({ ...config, configFile: false,
    root: fileURLToPath(new URL("../../admin-web", import.meta.url)), logLevel: "silent",
    server: { ...config.server, host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  proxyUrl = `http://127.0.0.1:${vite.httpServer.address().port}`;
  api = await vite.ssrLoadModule("/src/lib/api.ts");
});

after(async () => {
  await vite?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  mock.restoreAll();
});

const tokenFor = async role => {
  const actor = [...actors.values()].find(user => user.role === role);
  return accessToken(actor.id, actor.id);
};

test("the real server mounts admin middleware and rejects anonymous/USER access before inventory reads", async () => {
  const before = inventoryReads;
  const anonymous = await network(`${backendUrl}/api/admin/users`, { headers: { Origin: origin } });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("cache-control"), "no-store");
  assert.ok(anonymous.headers.get("x-request-id"));
  const user = await network(`${backendUrl}/api/admin/users`, {
    headers: { Origin: origin, Authorization: `Bearer ${await tokenFor("USER")}` },
  });
  assert.equal(user.status, 403);
  assert.equal((await user.json()).code, "ADMIN_REQUIRED");
  const malformed = await network(`${backendUrl}/api/admin/users`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{",
  });
  assert.equal(malformed.status, 400);
  const error = await malformed.json();
  assert.equal(error.code, "INVALID_INPUT");
  assert.equal(error.requestId, malformed.headers.get("x-request-id"));
  assert.equal(inventoryReads, before);
});

test("apiFetch reaches /api/admin/users through the actual Vite proxy with headers and cookies intact", async () => {
  // Node has no page origin, so resolve browser-relative fetch URLs against Vite.
  const bridgedFetch = mock.method(globalThis, "fetch", (input, options) => network(new URL(input, proxyUrl), options));
  try {
    for (const role of ["ADMIN"]) {
      api.setAccessToken(await tokenFor(role));
      const response = await api.apiFetch("/admin/users", {
        headers: { Origin: origin, Cookie: "__Host-proxy-probe=original", "X-Client-Platform": "web" },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
      assert.equal((await response.json()).pagination.total, actors.size);
      const forwarded = seen.at(-1);
      assert.equal(forwarded.url, "/api/admin/users");
      assert.equal(forwarded.headers.cookie, "__Host-proxy-probe=original");
      assert.equal(forwarded.headers.origin, origin);
      assert.equal(forwarded.headers["x-client-platform"], "web");
      assert.equal(forwarded.headers["x-csrf-protection"], "1");
      assert.ok(forwarded.headers.authorization.startsWith("Bearer "));
    }
    api.setAccessToken(await tokenFor("LEAD_DEV"));
    await assert.rejects(() => api.apiFetch("/admin/users", { headers: { Origin: origin } }), error =>
      error.status === 403 && error.code === "FORBIDDEN");
    const probe = await api.apiFetch("/auth/proxy-probe", { method: "POST",
      headers: { Origin: origin, Cookie: "__Host-proxy-probe=original" },
    });
    assert.match(probe.headers.get("set-cookie"), /^__Host-proxy-probe=rotated;/);
    assert.equal((await probe.json()).cookie, "__Host-proxy-probe=original");
  } finally {
    bridgedFetch.mock.restore();
  }
});

test("production CORS accepts explicitly opted-in localhost and the proxy rejects unlisted origins with 403", async () => {
  // Vite answers its own OPTIONS requests; exercise Express's preflight directly.
  const preflight = await network(`${backendUrl}/api/admin/users`, { method: "OPTIONS", headers: {
    Origin: origin, "Access-Control-Request-Method": "GET",
    "Access-Control-Request-Headers": "authorization,x-csrf-protection",
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
  const denied = await network(`${proxyUrl}/api/admin/users`, { headers: { Origin: "https://evil.test" } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "ORIGIN_REJECTED");
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("the localhost opt-in rejects malicious browser origins before admin reads or mutations", async () => {
  const beforeReads = inventoryReads;
  const authorization = `Bearer ${await tokenFor("ADMIN")}`;
  for (const Origin of ["https://evil.test", "http://localhost.evil.test:5174", "http://localhost:5173",
    "http://127.0.0.1:5174", "null"]) {
    for (const method of ["GET", "POST", "OPTIONS"]) {
      const response = await network(`${backendUrl}/api/admin/users`, {
        method,
        headers: { Origin, Authorization: authorization, "X-CSRF-Protection": "1", "X-Auth-Client": "native",
          "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json",
          ...(method === "OPTIONS" ? { "Access-Control-Request-Method": "POST" } : {}),
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "ORIGIN_REJECTED");
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
  }
  assert.equal(inventoryReads, beforeReads);
});
