import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import "tsx/cjs";
import { memoryModel } from "./helpers/security-store.mjs";

process.env.AUTH_PROVIDER = "supabase";
process.env.AUTH_JWT_SECRET = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM";
process.env.AUTH_JWT_ISSUER = "test-issuer";
process.env.AUTH_JWT_AUDIENCE = "test-audience";
process.env.AUTH_ALLOWED_ORIGINS = "https://example.test";
process.env.SUPABASE_URL = "https://provider.example.test";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

const issuer = `${process.env.SUPABASE_URL}/auth/v1`;
const signingKey = new TextEncoder().encode("a-different-provider-signing-secret-for-tests");
const users = new Map(), identities = new Map(), sessions = new Map(), refreshTokens = new Map(), codes = new Map();
const challenges = new Map(), verifications = new Map(), auditLogs = new Map(), devices = new Map();
const preservedId = "2da2cd1a-e594-43cc-a165-552342882246";
let server, base, network, sequence = 10000000, upstreamCalls = [], asymmetric, publicJwk;
let algorithm = "HS256", refuseRevocation = false, autoConfirm = false;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const db = {
  user: memoryModel(users, { unique: ["email", "supabaseUserId"], defaults: () => ({ name: null, role: "USER", isActive: true,
    authVersion: 0, authInvalidBefore: null, createdAt: new Date(), updatedAt: new Date() }) }),
  adminChallenge: memoryModel(challenges, { unique: ["challengeHash"], resolveUser: id => users.get(id), defaults: () => ({
    attempts: 0, maxAttempts: 5, consumedAt: null, createdAt: new Date(), lastSentAt: new Date(),
  }) }),
  adminSessionVerification: memoryModel(verifications, { unique: ["supabaseSessionId"], defaults: () => ({ verifiedAt: new Date(), authVersion: 0 }) }),
  auditLog: memoryModel(auditLogs, { resolveUser: id => users.get(id), defaults: () => ({ createdAt: new Date(), targetId: null, ipAddress: null }) }),
  device: memoryModel(devices, { resolveUser: id => users.get(id) }),
  // Provider auth must not write either legacy table.
  authSession: { create() { throw new Error("Legacy session write forbidden"); }, updateMany() { throw new Error("Legacy revocation forbidden"); } },
  refreshToken: { create() { throw new Error("Legacy token write forbidden"); }, deleteMany() { throw new Error("Legacy token deletion forbidden"); } },
};
let transactionFlight = Promise.resolve();
db.$transaction = callback => {
  const operation = transactionFlight.then(async () => {
    const tables = [users, challenges, verifications, auditLogs];
    const copies = tables.map(table => structuredClone([...table.entries()]));
    try { return await callback(db); }
    catch (error) { tables.forEach((table, index) => { table.clear(); for (const [key, value] of copies[index]) table.set(key, value); }); throw error; }
  });
  transactionFlight = operation.catch(() => {});
  return operation;
};
const authRead = {
  session: async id => sessions.get(id) ?? null,
  sessions: async userId => [...sessions.values()].filter(session => session.userId === userId),
  user: async id => identities.get(id) ?? null,
};
function sendCode(email, type) {
  const code = String(++sequence);
  codes.set(`${email}:${type}`, code);
  return code;
}
async function tokenFor(identity, sessionId = randomUUID(), changes = {}) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, { id: sessionId, userId: identity.id, createdAt: new Date(), notAfter: null });
  const access_token = await new SignJWT({ session_id: sessionId, role: "ADMIN", ...changes })
    .setProtectedHeader({ alg: algorithm, ...(algorithm === "ES256" ? { kid: "test-key" } : {}) })
    .setSubject(identity.id).setIssuer(issuer).setAudience("authenticated").setIssuedAt().setExpirationTime("15m")
    .sign(algorithm === "ES256" ? asymmetric.privateKey : signingKey);
  const refresh_token = randomUUID();
  refreshTokens.set(refresh_token, sessionId);
  return { access_token, refresh_token, expires_in: 900 };
}
const serialized = identity => ({ id: identity.id, email: identity.email,
  email_confirmed_at: identity.emailConfirmedAt?.toISOString() ?? null, user_metadata: { name: identity.name, role: "ADMIN" } });
async function providerRequest(input, init = {}) {
  const url = new URL(String(input));
  if (url.origin !== process.env.SUPABASE_URL) return network(input, init);
  const path = url.pathname.slice("/auth/v1".length);
  const body = init.body ? JSON.parse(init.body) : {};
  const headers = new Headers(init.headers);
  upstreamCalls.push({ path, body, headers });
  if (path === "/.well-known/jwks.json") return json({ keys: [publicJwk] });
  assert.equal(headers.get("apikey"), path === "/logout" || path.startsWith("/admin/") ? "sb_secret_test" : "sb_publishable_test");
  if (path === "/admin/users" && init.method === "POST") {
    assert.equal(headers.get("authorization"), "Bearer sb_secret_test");
    const identity = { id: randomUUID(), email: body.email, password: body.password, name: body.user_metadata.name,
      emailConfirmedAt: body.email_confirm ? new Date() : null, bannedUntil: null };
    identities.set(identity.id, identity);
    return json(serialized(identity));
  }
  if (path.startsWith("/admin/users/") && init.method === "DELETE") {
    const id = path.slice("/admin/users/".length);
    identities.delete(id);
    for (const [sessionId, session] of sessions) if (session.userId === id) sessions.delete(sessionId);
    return json({});
  }
  if (path === "/signup") {
    if ([...identities.values()].some(user => user.email === body.email)) return json({});
    const identity = { id: randomUUID(), email: body.email, password: body.password, name: body.data?.name,
      emailConfirmedAt: autoConfirm ? new Date() : null, bannedUntil: null };
    identities.set(identity.id, identity);
    sendCode(body.email, "signup");
    return json(autoConfirm ? await tokenFor(identity) : serialized(identity));
  }
  if (path === "/recover" || path === "/otp" || path === "/resend") {
    if (path === "/otp") assert.equal(body.create_user, false);
    const identity = [...identities.values()].find(user => user.email === body.email);
    if (identity) sendCode(body.email, path === "/recover" ? "recovery" : path === "/resend" ? "signup" : "magiclink");
    return json({});
  }
  if (path === "/verify") {
    const key = `${body.email}:${body.type}`;
    const identity = [...identities.values()].find(user => user.email === body.email);
    if (!identity || codes.get(key) !== body.token) return json({ error: "expired" }, 403);
    codes.delete(key);
    identity.emailConfirmedAt ??= new Date();
    return json(await tokenFor(identity));
  }
  if (path === "/token") {
    if (url.searchParams.get("grant_type") === "password") {
      const identity = [...identities.values()].find(user => user.email === body.email);
      if (!identity?.emailConfirmedAt || identity.password !== body.password) return json({}, 400);
      return json(await tokenFor(identity));
    }
    const id = refreshTokens.get(body.refresh_token);
    const session = sessions.get(id);
    if (!session) return json({}, 400);
    refreshTokens.delete(body.refresh_token);
    return json(await tokenFor(identities.get(session.userId), id));
  }
  let claims;
  try {
    claims = (await jwtVerify((headers.get("authorization") ?? "").slice(7),
      algorithm === "ES256" ? asymmetric.publicKey : signingKey,
      { issuer, audience: "authenticated" })).payload;
  } catch { return json({}, 401); }
  const identity = identities.get(claims.sub);
  if (!identity) return json({}, 401);
  if (path === "/user") {
    if (init.method === "PUT") {
      if (body.password === identity.password) return json({}, 422);
      identity.password = body.password;
      // Supabase password update revokes other sessions, retaining the current one.
      for (const [id, session] of sessions) if (session.userId === identity.id && id !== claims.session_id) sessions.delete(id);
    }
    return json(serialized(identity));
  }
  if (path === "/logout") {
    if (!refuseRevocation) {
      for (const [id, session] of sessions)
        if (url.searchParams.get("scope") === "local" ? id === claims.session_id : session.userId === identity.id) sessions.delete(id);
    }
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected provider path ${path}`);
}
before(async () => {
  asymmetric = await generateKeyPair("ES256", { extractable: true });
  publicJwk = { ...await exportJWK(asymmetric.publicKey), kid: "test-key", alg: "ES256" };
  network = globalThis.fetch;
  mock.method(globalThis, "fetch", providerRequest);
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: db } });
  mock.module(new URL("../src/lib/prisma-auth-read.js", import.meta.url).href, { namedExports: { authRead } });
  const { authRouter } = await import("../src/routes/auth.ts");
  const { requireAuth, requireAdmin, safeUser } = await import("../src/lib/auth.ts");
  const { errorHandler } = await import("../src/lib/http.ts");
  mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: { sensorReading: { findFirst: async () => null } } } });
  const { adminRouter, adminErrorHandler } = await import("../src/routes/admin.ts");
  const { devicesRouter } = await import("../src/routes/devices.ts");
  const { plantsRouter } = await import("../src/routes/plants.ts");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/admin", adminErrorHandler);
  app.use("/api/devices", devicesRouter);
  app.use("/api/plants", plantsRouter);
  app.get("/api/users/me", requireAuth, (_req, res) => res.json(safeUser(res.locals.auth.user)));
  app.get("/admin", requireAuth, requireAdmin, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  process.env.AUTH_PROVIDER = "supabase";
  users.clear(); identities.clear(); sessions.clear(); refreshTokens.clear(); codes.clear(); upstreamCalls = [];
  challenges.clear(); verifications.clear(); auditLogs.clear(); devices.clear();
  algorithm = "HS256"; refuseRevocation = false; autoConfirm = false;
  users.set(preservedId, { id: preservedId, email: "cuaresmaroniel27@gmail.com", password: "preserve-exact-hash",
    role: "USER", isActive: true, name: "Preserved", supabaseUserId: null, emailVerifiedAt: null,
    createdAt: new Date(), updatedAt: new Date() });
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  mock.restoreAll();
});
async function request(path, body, token, method = "POST") {
  const response = await fetch(`${base}${path.startsWith("/api/") || path === "/admin" ? path : `/api/auth${path}`}`, {
    method, headers: { "X-Auth-Client": "native", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
}
async function registered(email = "new@example.test") {
  const pending = await request("/register", { email, password: "original password", name: "Name" });
  assert.equal(pending.status, 202);
  const result = await request("/otp/verify", { email, code: codes.get(`${email}:signup`), type: "signup" });
  assert.equal(result.status, 200);
  return result.body;
}

async function browserRequest(path, { body = {}, token, cookie, headers = {} } = {}) {
  const requestHeaders = new Headers({ Origin: "https://example.test",
    "X-CSRF-Protection": "1", "Content-Type": "application/json" });
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  if (cookie) requestHeaders.set("Cookie", cookie);
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) requestHeaders.delete(name);
    else requestHeaders.set(name, value);
  }
  const response = await fetch(`${base}/api/auth${path}`, {
    method: "POST", headers: requestHeaders, body: JSON.stringify(body),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
}

test("Supabase browser login and refresh use cookies; both logout scopes clear and revoke them", async () => {
  for (const path of ["/logout", "/logout-all"]) {
    const account = await registered(`${path.slice(1)}@example.test`);
    users.get(account.user.id).role = "LEAD_DEV";
    const login = await browserRequest("/login", {
      body: { email: account.user.email, password: "original password" },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, "LEAD_DEV");
    assert.equal(login.body.refreshToken, undefined);
    const cookie = login.headers.get("set-cookie");
    assert.doesNotMatch(cookie, /(?:^|;)\s*(?:Max-Age|Expires)=/i);
    assert.ok(cookie.startsWith("__Host-leafcheck-refresh="));
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
      assert.ok(cookie.includes(attribute));

    const refreshed = await browserRequest("/refresh", { cookie: cookie.split(";")[0] });
    assert.equal(refreshed.status, 200);
    assert.doesNotMatch(refreshed.headers.get("set-cookie"), /(?:^|;)\s*(?:Max-Age|Expires)=/i);
    assert.deepEqual(Object.keys(refreshed.body).sort(), ["accessToken", "expiresIn"]);
    const rotatedCookie = refreshed.headers.get("set-cookie").split(";")[0];
    assert.notEqual(rotatedCookie, cookie.split(";")[0]);
    assert.equal((await browserRequest("/refresh", {
      body: { refreshToken: account.refreshToken }, cookie: rotatedCookie,
    })).status, 400);

    const logout = await browserRequest(path, { token: refreshed.body.accessToken, cookie: rotatedCookie });
    assert.equal(logout.status, 204);
    const cleared = logout.headers.get("set-cookie");
    assert.ok(cleared.startsWith("__Host-leafcheck-refresh=;"));
    assert.match(cleared, /Expires=Thu, 01 Jan 1970/);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
      assert.ok(cleared.includes(attribute));
    assert.equal((await browserRequest("/refresh", { cookie: rotatedCookie })).status, 401);
    assert.equal((await request("/api/users/me", undefined, refreshed.body.accessToken, "GET")).status, 401);
    assert.equal((await request("/api/users/me", undefined, account.accessToken, "GET")).status,
      path === "/logout-all" ? 401 : 200);
  }
});

test("Supabase browser actions enforce origin/CSRF and keep registration, OTP and recovery native-only", async () => {
  for (const path of ["/login", "/refresh", "/logout", "/logout-all", "/verify-admin-otp", "/admin-otp/resend", "/admin-otp/cancel"]) {
    for (const headers of [{ Origin: null }, { Origin: "https://evil.test", "X-Auth-Client": "native" },
      { "X-CSRF-Protection": null }, { "X-CSRF-Protection": "0" }]) {
      const result = await browserRequest(path, { headers });
      assert.equal(result.status, 403);
      assert.equal(result.body.code, "ORIGIN_REJECTED");
    }
  }
  for (const path of ["/register", "/otp/request", "/otp/verify", "/otp/resend", "/forgot-password", "/reset-password"]) {
    const result = await browserRequest(path);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, "NATIVE_REQUIRED");
  }
  assert.equal(upstreamCalls.length, 0);
});

async function staffAccount(role = "ADMIN") {
  const account = await registered(`${role.toLowerCase()}-${randomUUID()}@example.test`);
  users.get(account.user.id).role = role;
  return account;
}
async function verifiedAdministrator() {
  const account = await staffAccount();
  const challenge = await browserRequest("/login", { body: { email: account.user.email, password: "original password" } });
  assert.equal(challenge.status, 202);
  const verified = await browserRequest("/verify-admin-otp", { body: {
    challengeToken: challenge.body.challengeToken, code: codes.get(`${account.user.email}:magiclink`),
  } });
  assert.equal(verified.status, 200);
  assert.doesNotMatch(verified.headers.get("set-cookie"), /(?:^|;)\s*(?:Max-Age|Expires)=/i);
  return { ...account, ...verified.body, cookie: verified.headers.get("set-cookie").split(";")[0], challenge: challenge.body };
}
async function adminRequest(path, token, method = "GET", body) {
  const response = await fetch(`${base}/api/admin${path}`, { method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
}

test("LEAD_DEV password login returns a JWT immediately but all user and audit operations are forbidden", async () => {
  const account = await staffAccount("LEAD_DEV");
  const login = await request("/login", { email: account.user.email, password: "original password" });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.accessToken, "string");
  assert.equal(challenges.size, 0);
  assert.equal((await adminRequest("/devices", login.body.accessToken)).status, 200);
  for (const [path, method, body] of [["/users", "GET"], ["/admins", "GET"], ["/audit", "GET"],
    ["/devices/whitelist", "GET"], [`/users/${account.user.id}`, "GET"], ["/users", "POST", {}],
    [`/users/${account.user.id}`, "PATCH", { role: "ADMIN" }], [`/users/${account.user.id}`, "DELETE"]]) {
    const result = await adminRequest(path, login.body.accessToken, method, body);
    assert.equal(result.status, 403, `${method} ${path}`);
    assert.equal(result.body.code, "FORBIDDEN");
  }
  for (const [path, method, body] of [["/api/devices/claim", "POST", { macAddress: "LC-A50528" }],
    [`/api/plants/${randomUUID()}/pair-device`, "PATCH", { deviceId: randomUUID() }],
    [`/api/plants/${randomUUID()}/seed-telemetry`, "POST", {}]]) {
    const denied = await request(path, body, login.body.accessToken, method);
    assert.equal(denied.status, 403); assert.equal(denied.body.code, "FORBIDDEN");
  }
});

test("ADMIN password login returns a hashed five-minute OTP challenge and no usable browser credentials", async () => {
  const account = await staffAccount();
  const result = await browserRequest("/login", { body: { email: account.user.email, password: "original password" } });
  assert.equal(result.status, 202);
  assert.equal(result.body.status, "otp_required");
  assert.equal(result.body.accessToken, undefined);
  assert.equal(result.body.refreshToken, undefined);
  assert.ok(!result.body.maskedEmail.includes(account.user.email));
  assert.match(result.headers.get("set-cookie"), /__Host-leafcheck-refresh=;/);
  const pending = [...challenges.values()][0];
  assert.notEqual(pending.challengeHash, result.body.challengeToken);
  assert.match(pending.challengeHash, /^[a-f0-9]{64}$/);
  assert.equal(pending.attempts, 0); assert.equal(pending.maxAttempts, 5);
  assert.ok(pending.expiresAt - pending.createdAt <= 300_000);
  assert.equal(verifications.size, 0);
  assert.equal(sessions.size, 1, "the provisional password session was revoked");
});

test("a valid unverified ADMIN JWT is rejected across the entire admin router", async () => {
  const account = await staffAccount();
  for (const [path, method, body] of [["/users", "GET"], ["/devices", "GET"], ["/audit", "GET"],
    ["/admins", "GET"], ["/devices/whitelist", "GET"], ["/stats", "GET"], ["/health", "GET"], ["/users", "POST", {}],
    [`/users/${account.user.id}`, "PATCH", {}], [`/users/${account.user.id}`, "DELETE"], ["/unknown", "GET"]]) {
    const result = await adminRequest(path, account.accessToken, method, body);
    assert.equal(result.status, 403, `${method} ${path}`);
    assert.equal(result.body.code, "ADMIN_VERIFICATION_REQUIRED");
  }
});

test("ADMIN OTP verification issues JWT and secure refresh cookie, consumes once, and records an audit", async () => {
  const admin = await verifiedAdministrator();
  assert.equal((await adminRequest("/users", admin.accessToken)).status, 200);
  const claims = (await jwtVerify(admin.accessToken, signingKey)).payload;
  const proof = [...verifications.values()][0];
  assert.equal(proof.supabaseSessionId, claims.session_id);
  assert.equal(proof.userId, admin.user.id);
  assert.ok(proof.expiresAt - proof.verifiedAt <= 8 * 3_600_000);
  assert.ok([...challenges.values()][0].consumedAt instanceof Date);
  const audit = [...auditLogs.values()].find(row => row.action === "ADMIN_LOGIN_VERIFIED");
  assert.equal(audit.actorId, admin.user.id);
  assert.equal(audit.metadata.method, "password_and_email_otp");
  const replay = await browserRequest("/verify-admin-otp", { body: { challengeToken: admin.challenge.challengeToken, code: "12345678" } });
  assert.equal(replay.status, 400);
  assert.equal(verifications.size, 1);
  assert.equal((await adminRequest("/users", admin.accessToken)).status, 200);
});

test("LEAD_DEV device responses omit every owner identity field while verified ADMIN receives owner details", async () => {
  const lead = await staffAccount("LEAD_DEV");
  devices.set(randomUUID(), { id: randomUUID(), userId: preservedId, name: "Indoor sensor", macAddress: "LC-A50528",
    plants: [], status: "OFFLINE", createdAt: new Date(), updatedAt: new Date() });
  const result = await adminRequest("/devices", lead.accessToken);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 1);
  assert.equal("owner" in result.body.data[0], false);
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes(users.get(preservedId).email));
  assert.ok(!serialized.includes("emailMasked"));
  assert.ok(!serialized.includes("isActive"));
  const deniedFilter = await adminRequest(`/devices?userId=${preservedId}`, lead.accessToken);
  assert.equal(deniedFilter.status, 403);
  const admin = await verifiedAdministrator();
  const full = await adminRequest("/devices", admin.accessToken);
  assert.equal(full.body.data[0].owner.email, users.get(preservedId).email);
});

test("ADMIN refresh requires the same verified session and clears unverified browser cookies", async () => {
  const account = await staffAccount();
  const denied = await browserRequest("/refresh", { cookie: `__Host-leafcheck-refresh=${account.refreshToken}` });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "ADMIN_VERIFICATION_REQUIRED");
  assert.match(denied.headers.get("set-cookie"), /__Host-leafcheck-refresh=;/);
  const admin = await verifiedAdministrator();
  const refreshed = await browserRequest("/refresh", { cookie: admin.cookie });
  assert.equal(refreshed.status, 200);
  assert.equal((await adminRequest("/users", refreshed.body.accessToken)).status, 200);
  [...verifications.values()][0].expiresAt = new Date(Date.now() - 1);
  const expired = await adminRequest("/users", refreshed.body.accessToken);
  assert.equal(expired.status, 403); assert.equal(expired.body.code, "ADMIN_VERIFICATION_REQUIRED");
});

test("proofs cannot be transferred between accounts, session IDs, or account security versions", async () => {
  const admin = await verifiedAdministrator();
  const proof = [...verifications.values()][0];
  for (const change of [{ userId: preservedId }, { supabaseSessionId: randomUUID() }, { authVersion: 99 }, { verifiedAt: new Date(Date.now() + 60_000) }]) {
    const previous = { ...proof };
    Object.assign(proof, change);
    assert.equal((await adminRequest("/users", admin.accessToken)).status, 403);
    Object.assign(proof, previous);
  }
});

test("OTP guesses are limited to five provider attempts and challenges are origin/client bound", async () => {
  const account = await staffAccount();
  const login = await browserRequest("/login", { body: { email: account.user.email, password: "original password" } });
  const challengeToken = login.body.challengeToken;
  assert.equal((await request("/verify-admin-otp", { challengeToken, code: "00000000" })).status, 400);
  for (let attempt = 0; attempt < 5; attempt++) {
    const wrong = await browserRequest("/verify-admin-otp", { body: { challengeToken, code: "00000000" } });
    assert.equal(wrong.status, 400); assert.equal(wrong.body.code, "INVALID_CODE");
  }
  const exhausted = await browserRequest("/verify-admin-otp", { body: { challengeToken, code: codes.get(`${account.user.email}:magiclink`) } });
  assert.equal(exhausted.body.code, "INVALID_CHALLENGE");
  assert.equal(upstreamCalls.filter(call => call.path === "/verify" && call.body.type === "magiclink").length, 5);
  assert.equal([...challenges.values()][0].attempts, 5);
});

test("resend increments the shared attempt budget without extending expiry; cancellation is idempotent", async () => {
  const account = await staffAccount();
  const login = await browserRequest("/login", { body: { email: account.user.email, password: "original password" } });
  const challengeToken = login.body.challengeToken;
  const pending = [...challenges.values()][0];
  const expiry = pending.expiresAt.getTime();
  assert.equal((await browserRequest("/admin-otp/resend", { body: { challengeToken } })).status, 429);
  pending.lastSentAt = new Date(Date.now() - 60_001);
  assert.equal((await browserRequest("/admin-otp/resend", { body: { challengeToken } })).status, 202);
  assert.equal(pending.attempts, 1); assert.equal(pending.expiresAt.getTime(), expiry);
  for (let repeat = 0; repeat < 2; repeat++)
    assert.equal((await browserRequest("/admin-otp/cancel", { body: { challengeToken } })).status, 204);
  assert.equal((await browserRequest("/verify-admin-otp", { body: { challengeToken, code: codes.get(`${account.user.email}:magiclink`) } })).status, 400);
});

test("expired challenges and changed roles fail closed before a privileged session can be issued", async () => {
  for (const mutate of [record => { record.expiresAt = new Date(Date.now() - 1); }, record => { users.get(record.userId).role = "LEAD_DEV"; }]) {
    const account = await staffAccount();
    const login = await browserRequest("/login", { body: { email: account.user.email, password: "original password" } });
    mutate([...challenges.values()].find(record => record.userId === account.user.id));
    const result = await browserRequest("/verify-admin-otp", { body: { challengeToken: login.body.challengeToken, code: codes.get(`${account.user.email}:magiclink`) } });
    assert.equal(result.status, 400); assert.equal(verifications.size, 0);
  }
});

test("concurrent OTP submissions can authorize only one session", async () => {
  const account = await staffAccount();
  const login = await browserRequest("/login", { body: { email: account.user.email, password: "original password" } });
  const body = { challengeToken: login.body.challengeToken, code: codes.get(`${account.user.email}:magiclink`) };
  const results = await Promise.all([browserRequest("/verify-admin-otp", { body }), browserRequest("/verify-admin-otp", { body })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
  assert.equal(verifications.size, 1);
});

test("the generic native OTP and legacy login paths cannot grant a password-only ADMIN session", async () => {
  const account = await staffAccount();
  await request("/otp/request", { email: account.user.email });
  const bypass = await request("/otp/verify", { email: account.user.email, code: codes.get(`${account.user.email}:magiclink`), type: "magiclink" });
  assert.equal(bypass.status, 403); assert.equal(bypass.body.code, "ADMIN_VERIFICATION_REQUIRED");
  const hash = await (await import("../src/lib/password.ts")).hashPassword("original password");
  users.get(account.user.id).password = hash;
  process.env.AUTH_PROVIDER = "legacy";
  const legacy = await request("/login", { email: account.user.email, password: "original password" });
  assert.equal(legacy.status, 403); assert.equal(legacy.body.accessToken, undefined);
});

test("SuperAdmin creates linked accounts, edits roles and bans users with matching audit events", async () => {
  const admin = await verifiedAdministrator();
  const created = await adminRequest("/users", admin.accessToken, "POST", { email: "manual@example.test", password: "manual password", name: "Manual", role: "USER" });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal(created.body.data.password, undefined);
  assert.ok(users.get(id).supabaseUserId);
  const login = await request("/login", { email: "manual@example.test", password: "manual password" });
  assert.equal(login.status, 200);
  const edited = await adminRequest(`/users/${id}`, admin.accessToken, "PATCH", { role: "LEAD_DEV", name: "Operator", updatedAt: created.body.data.updatedAt });
  assert.equal(edited.status, 200); assert.equal(edited.body.data.role, "LEAD_DEV");
  assert.equal((await request("/api/users/me", undefined, login.body.accessToken, "GET")).status, 401);
  assert.equal((await adminRequest(`/users/${id}`, admin.accessToken, "PATCH", { isActive: false, updatedAt: users.get(id).updatedAt.toISOString() })).status, 200);
  assert.equal((await request("/login", { email: "manual@example.test", password: "manual password" })).status, 401);
  assert.equal((await adminRequest(`/users/${id}`, admin.accessToken, "PATCH", { isActive: true, updatedAt: users.get(id).updatedAt.toISOString() })).status, 200);
  assert.equal((await request("/refresh", { refreshToken: login.body.refreshToken })).status, 401);
  const actions = [...auditLogs.values()].filter(row => row.targetId === id).map(row => row.action);
  assert.deepEqual(actions, ["USER_CREATED", "USER_UPDATED", "USER_UPDATED", "USER_UPDATED"]);
  const serialized = JSON.stringify([...auditLogs.values()]);
  for (const secret of ["manual password", admin.accessToken, admin.challenge.challengeToken]) assert.ok(!serialized.includes(secret));
});

test("SuperAdmin can create a banned account, omitted status defaults active, and system fields cannot be forged", async () => {
  const admin = await verifiedAdministrator();
  const create = body => adminRequest("/users", admin.accessToken, "POST", { email: "initially-banned@example.test", password: "manual password", ...body });
  const banned = await create({ isActive: false });
  assert.equal(banned.status, 201);
  assert.equal(banned.body.data.isActive, false);
  assert.equal(users.get(banned.body.data.id).isActive, false);
  assert.equal((await request("/login", { email: banned.body.data.email, password: "manual password" })).status, 401);
  const event = [...auditLogs.values()].find(row => row.action === "USER_CREATED" && row.targetId === banned.body.data.id);
  assert.equal(event.metadata.isActive, false);
  const active = await create({ email: "default-active@example.test" });
  assert.equal(active.status, 201); assert.equal(active.body.data.isActive, true);
  for (const body of [{ isActive: "false" }, { isActive: 0 }, { isActive: null },
    { emailVerifiedAt: new Date().toISOString() }, { supabaseUserId: randomUUID() }]) {
    assert.equal((await create({ email: "invalid-provisioning@example.test", ...body })).status, 400);
  }
});

test("admin user validation exposes safe field errors without accepting invalid input", async () => {
  const admin = await verifiedAdministrator();
  const invalid = await adminRequest("/users", admin.accessToken, "POST", { email: "invalid", password: "short" });
  assert.equal(invalid.status, 400);
  assert.equal(typeof invalid.body.fieldErrors.email, "string");
  assert.equal(typeof invalid.body.fieldErrors.password, "string");
  const role = await adminRequest(`/users/${admin.user.id}`, admin.accessToken, "PATCH", {
    role: "OWNER", updatedAt: users.get(admin.user.id).updatedAt.toISOString(),
  });
  assert.equal(role.status, 400); assert.equal(typeof role.body.fieldErrors.role, "string");
});

test("user mutations reject self-ban, self-delete, last-admin demotion, invalid roles and unknown fields", async () => {
  const admin = await verifiedAdministrator();
  const path = `/users/${admin.user.id}`;
  const updatedAt = users.get(admin.user.id).updatedAt.toISOString();
  assert.equal((await adminRequest(path, admin.accessToken, "PATCH", { isActive: false, updatedAt })).body.code, "SELF_BAN_FORBIDDEN");
  assert.equal((await adminRequest(path, admin.accessToken, "DELETE")).body.code, "SELF_DELETE_FORBIDDEN");
  assert.equal((await adminRequest(path, admin.accessToken, "PATCH", { role: "LEAD_DEV", updatedAt })).body.code, "LAST_ADMIN");
  for (const body of [{}, { role: "SUPERADMIN" }, { isActive: "false" }, { password: "injected" }])
    assert.equal((await adminRequest(path, admin.accessToken, "PATCH", { ...body, updatedAt })).status, 400);
});

test("user deletion removes provider and application identities and logs completion", async () => {
  const admin = await verifiedAdministrator();
  const target = await registered("delete@example.test");
  const providerId = users.get(target.user.id).supabaseUserId;
  assert.equal((await adminRequest(`/users/${target.user.id}`, admin.accessToken, "DELETE")).status, 204);
  assert.equal(users.has(target.user.id), false); assert.equal(identities.has(providerId), false);
  assert.equal((await request("/api/users/me", undefined, target.accessToken, "GET")).status, 401);
  assert.ok([...auditLogs.values()].some(row => row.action === "USER_DELETED" && row.targetId === target.user.id));
});

test("audit endpoint is paginated, filterable, and read only", async () => {
  const admin = await verifiedAdministrator();
  const result = await adminRequest(`/audit?action=ADMIN_LOGIN_VERIFIED&actorId=${admin.user.id}&pageSize=1`, admin.accessToken);
  assert.equal(result.status, 200); assert.equal(result.body.pagination.total, 1);
  assert.equal(result.body.data[0].actorId, admin.user.id);
  assert.equal(result.body.data[0].actorEmail, admin.user.email);
  assert.equal(result.body.data[0].targetEmail, admin.user.email);
  assert.equal((await adminRequest("/audit?from=invalid", admin.accessToken)).status, 400);
  assert.equal((await adminRequest("/audit?unknown=true", admin.accessToken)).status, 400);
  assert.equal((await adminRequest("/audit", admin.accessToken, "DELETE")).status, 404);
});

test("legacy switch gates every new mutation and does not contact Supabase", async () => {
  process.env.AUTH_PROVIDER = "legacy";
  for (const path of ["/forgot-password", "/reset-password", "/otp/request", "/otp/verify", "/otp/resend"])
    assert.equal((await request(path, { email: "x@example.test" })).status, 503);
  assert.deepEqual((await request("/capabilities", undefined, undefined, "GET")).body,
    { provider: "legacy", emailOtp: false, passwordRecovery: false });
  assert.equal(upstreamCalls.length, 0);
});
test("registration requires the emailed OTP, provisions once, and preserves the original account", async () => {
  const preserved = structuredClone(users.get(preservedId));
  const pending = await request("/register", { email: "New@Example.test", password: "original password", name: "Name" });
  assert.equal(pending.status, 202);
  assert.equal(pending.body.status, "verification_required");
  assert.equal(pending.body.accessToken, undefined);
  assert.equal(users.size, 1);
  assert.equal((await request("/otp/verify", { email: "new@example.test", code: "00000000", type: "signup" })).status, 400);
  const code = "00123456";
  codes.set("new@example.test:signup", code);
  const verified = await request("/otp/verify", { email: "new@example.test", code, type: "signup" });
  assert.equal(verified.status, 200);
  assert.equal(users.size, 2);
  const user = users.get(verified.body.user.id);
  assert.equal(user.role, "USER");
  assert.ok(user.supabaseUserId);
  assert.ok(user.emailVerifiedAt instanceof Date);
  assert.equal(await (await import("../src/lib/password.ts")).verifyPassword("original password", user.password), false);
  assert.equal((await request("/otp/verify", { email: user.email, code, type: "signup" })).status, 400);
  assert.deepEqual(users.get(preservedId), preserved);
  assert.equal((await request("/api/users/me", undefined, verified.body.accessToken, "GET")).body.id, user.id);
});
test("password reset consumes the recovery code, rejects old password and revokes every session", async () => {
  const account = await registered();
  const hash = users.get(account.user.id).password;
  const second = await request("/login", { email: account.user.email, password: "original password" });
  assert.equal(second.status, 200);
  assert.equal((await request("/forgot-password", { email: account.user.email })).status, 202);
  const code = "00654321";
  codes.set(`${account.user.email}:recovery`, code);
  assert.equal((await request("/reset-password", { email: account.user.email, code: "00000000", newPassword: "new password value" })).status, 400);
  const reset = await request("/reset-password", { email: account.user.email, code, newPassword: "  new password value  " });
  assert.equal(reset.status, 204);
  assert.equal(sessions.size, 0);
  assert.equal(users.get(account.user.id).password, hash);
  for (const token of [account.accessToken, second.body.accessToken])
    assert.equal((await request("/api/users/me", undefined, token, "GET")).status, 401);
  assert.equal((await request("/refresh", { refreshToken: account.refreshToken })).status, 401);
  assert.equal((await request("/login", { email: account.user.email, password: "original password" })).status, 401);
  assert.equal((await request("/login", { email: account.user.email, password: "  new password value  " })).status, 200);
  assert.equal((await request("/reset-password", { email: account.user.email, code, newPassword: "another password" })).status, 400);
});
test("OTP endpoints reject incorrect lengths, nondigits and numeric values before contacting Supabase", async () => {
  const bodies = [
    ["/otp/verify", { email: "person@example.test", type: "signup" }],
    ["/otp/verify", { email: "person@example.test", type: "magiclink" }],
    ["/reset-password", { email: "person@example.test", newPassword: "replacement password" }],
  ];
  for (const code of ["123456", "1234567", "123456789", "1234abcd", " 12345678", 12345678]) {
    for (const [path, body] of bodies) {
      const response = await request(path, { ...body, code });
      assert.equal(response.status, 400);
      assert.equal(response.body.code, "INVALID_INPUT");
      assert.equal(response.body.error, "Enter the eight-digit email code.");
    }
  }
  assert.equal(upstreamCalls.length, 0);
});
test("optional passwordless login never enrolls unknown or unmigrated accounts", async () => {
  const account = await registered();
  for (const email of ["unknown@example.test", "cuaresmaroniel27@gmail.com", account.user.email]) {
    const result = await request("/otp/request", { email });
    assert.equal(result.status, 202);
    assert.equal(result.body.purpose, "login");
  }
  assert.equal(upstreamCalls.filter(call => call.path === "/otp").length, 1);
  const invalidKnown = await request("/otp/verify", { email: account.user.email, code: "00000000", type: "magiclink" });
  const invalidUnknown = await request("/otp/verify", { email: "unknown@example.test", code: "00000000", type: "magiclink" });
  assert.deepEqual(invalidKnown.body, invalidUnknown.body);
  const code = codes.get(`${account.user.email}:magiclink`);
  const login = await request("/otp/verify", { email: account.user.email, code, type: "magiclink" });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, account.user.id);
  assert.equal(upstreamCalls.filter(call => call.path === "/verify").at(-1).body.type, "magiclink");
});

test("wrong OTP types return a clear 400 and do not consume the correctly typed code", async () => {
  const email = "typed@example.test";
  await request("/register", { email, password: "original password" });
  const signup = codes.get(`${email}:signup`);
  const wrong = await request("/otp/verify", { email, code: signup, type: "magiclink" });
  assert.equal(wrong.status, 400);
  assert.deepEqual(wrong.body, { code: "INVALID_CODE", error: "Invalid or expired code. Request a new one." });
  const correct = await request("/otp/verify", { email, code: signup, type: "signup" });
  assert.equal(correct.status, 200);
  assert.equal(upstreamCalls.filter(call => call.path === "/verify").at(-1).body.type, "signup");
  await request("/otp/request", { email });
  const login = codes.get(`${email}:magiclink`);
  const wrongSignup = await request("/otp/verify", { email, code: login, type: "signup" });
  assert.equal(wrongSignup.status, 400); assert.deepEqual(wrongSignup.body, wrong.body);
  assert.equal((await request("/otp/verify", { email, code: login, type: "magiclink" })).status, 200);
  const conflicting = await request("/otp/verify", { email, code: login, type: "signup", purpose: "login" });
  assert.equal(conflicting.status, 400); assert.deepEqual(conflicting.body, wrong.body);
});

test("resend dispatches signup, magiclink and recovery through their original provider flows", async () => {
  const email = "resend@example.test";
  await request("/register", { email, password: "original password" });
  const oldCode = codes.get(`${email}:signup`);
  assert.equal((await request("/otp/resend", { email, type: "signup" })).status, 202);
  assert.equal(upstreamCalls.at(-1).path, "/resend");
  assert.deepEqual(upstreamCalls.at(-1).body, { email, type: "signup" });
  assert.equal((await request("/otp/verify", { email, code: oldCode, type: "signup" })).status, 400);
  assert.equal((await request("/otp/verify", { email, code: codes.get(`${email}:signup`), type: "signup" })).status, 200);
  assert.equal((await request("/otp/resend", { email, type: "magiclink" })).status, 202);
  assert.equal(upstreamCalls.at(-1).path, "/otp");
  assert.equal(upstreamCalls.at(-1).body.create_user, false);
  assert.equal((await request("/otp/verify", { email, code: codes.get(`${email}:magiclink`), type: "magiclink" })).status, 200);
  assert.equal((await request("/otp/resend", { email, type: "recovery" })).status, 202);
  assert.equal(upstreamCalls.at(-1).path, "/recover");
  assert.equal((await request("/reset-password", { email, code: codes.get(`${email}:recovery`), newPassword: "replacement password" })).status, 204);
});

test("existing purpose-only clients retain their OTP verify and resend contracts", async () => {
  const email = "compatible@example.test";
  await request("/register", { email, password: "original password" });
  assert.equal((await request("/otp/resend", { email, purpose: "registration" })).status, 202);
  assert.equal((await request("/otp/verify", { email, code: codes.get(`${email}:signup`), purpose: "registration" })).status, 200);
  await request("/otp/request", { email });
  assert.equal((await request("/otp/verify", { email, code: codes.get(`${email}:magiclink`), purpose: "login" })).status, 200);
});

test("the OTP verification endpoint forwards an explicit recovery type unchanged", async () => {
  const account = await registered();
  await request("/forgot-password", { email: account.user.email });
  const verified = await request("/otp/verify", { email: account.user.email, code: codes.get(`${account.user.email}:recovery`), type: "recovery" });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.id, account.user.id);
  assert.equal(upstreamCalls.filter(call => call.path === "/verify").at(-1).body.type, "recovery");
});
test("logout invalidates JWT immediately; refresh keeps the existing contract and database roles win", async () => {
  const account = await registered();
  assert.equal((await request("/admin", undefined, account.accessToken, "GET")).status, 403);
  users.get(account.user.id).role = "ADMIN";
  assert.equal((await request("/admin", undefined, account.accessToken, "GET")).status, 200);
  users.get(account.user.id).role = "USER";
  const rotated = await request("/refresh", { refreshToken: account.refreshToken });
  assert.equal(rotated.status, 200);
  assert.deepEqual(Object.keys(rotated.body).sort(), ["accessToken", "expiresIn", "refreshToken"]);
  assert.equal((await request("/logout", {}, rotated.body.accessToken)).status, 204);
  assert.equal((await request("/api/users/me", undefined, account.accessToken, "GET")).status, 401);
  assert.equal((await request("/refresh", { refreshToken: rotated.body.refreshToken })).status, 401);
});
test("asymmetric JWKS tokens still require live sessions and current active user", async () => {
  algorithm = "ES256";
  const account = await registered();
  assert.ok(upstreamCalls.some(call => call.path === "/.well-known/jwks.json"));
  users.get(account.user.id).isActive = false;
  assert.equal((await request("/api/users/me", undefined, account.accessToken, "GET")).status, 401);
  users.get(account.user.id).isActive = true;
  sessions.clear();
  assert.equal((await request("/api/users/me", undefined, account.accessToken, "GET")).status, 401);
});
test("identity collisions never link by matching email or update a preserved User.id", async () => {
  const before = structuredClone(users.get(preservedId));
  assert.equal((await request("/register", { email: before.email, password: "a valid password" })).status, 409);
  const identity = { id: randomUUID(), email: before.email, emailConfirmedAt: new Date(), password: "password", name: null, bannedUntil: null };
  identities.set(identity.id, identity);
  sendCode(before.email, "signup");
  const result = await request("/otp/verify", { email: before.email, code: codes.get(`${before.email}:signup`), type: "signup" });
  assert.equal(result.status, 409);
  assert.equal(sessions.size, 0);
  assert.deepEqual(users.get(preservedId), before);
});
test("logout fails visibly if provider claims success but live session remains", async () => {
  const account = await registered();
  refuseRevocation = true;
  assert.equal((await request("/logout", {}, account.accessToken)).status, 503);
});
test("forgot password hides unknown/unmigrated emails, rejects bad input and sends no import", async () => {
  const absent = await request("/forgot-password", { email: "missing@example.test" });
  const unmapped = await request("/forgot-password", { email: "cuaresmaroniel27@gmail.com" });
  assert.deepEqual(absent.body, unmapped.body);
  assert.equal(upstreamCalls.length, 0);
  assert.equal((await request("/reset-password", { email: "x@example.test", code: "1234567", newPassword: "long password" })).status, 400);
  assert.equal((await request("/otp/verify", { email: "x@example.test", code: "12345678", purpose: "recovery" })).status, 400);
  assert.equal((await request("/forgot-password", { email: "x@example.test", role: "ADMIN" })).status, 400);
});
test("registration fails closed if dashboard Confirm email is disabled", async () => {
  autoConfirm = true;
  const result = await request("/register", { email: "auto@example.test", password: "a long password" });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "CONFIRM_EMAIL_REQUIRED");
  assert.equal(users.size, 1);
  assert.equal(sessions.size, 0);
});

test("native coordinator and API complete registration, passwordless login and password recovery through the BFF", async () => {
  const { createApiClient } = await import("../../frontend/services/api.ts");
  const { createSessionCoordinator } = await import("../../frontend/services/session.ts");
  let refresh = null;
  const coordinator = createSessionCoordinator({
    async get() { return refresh; }, async set(value) { refresh = value; }, async remove() { refresh = null; },
  }, true, { run: work => work(), broadcastLogout() {}, listenLogout: () => () => {} }, {
    async remove() {},
    async get() { throw new Error("Persisted access read forbidden"); },
    async set() { throw new Error("Persisted access write forbidden"); },
  });
  const api = createApiClient({ baseUrl: base, platform: "ios" });
  coordinator.bind(api); api.bindSession(coordinator);
  const pending = await coordinator.register({ email: "native@example.test", password: "original password" });
  assert.equal(pending.status, "verification_required");
  assert.equal(coordinator.snapshot().status, "verificationRequired");
  assert.equal(refresh, null);
  await assert.rejects(coordinator.verifyOtp("00000000"));
  assert.equal(coordinator.snapshot().pendingVerification.email, "native@example.test");
  await coordinator.verifyOtp(codes.get("native@example.test:signup"));
  assert.equal(coordinator.snapshot().status, "authenticated");
  assert.ok(refresh);
  const id = coordinator.snapshot().user.id;
  await coordinator.logout();
  await coordinator.requestLoginOtp({ email: "native@example.test" });
  await coordinator.verifyOtp(codes.get("native@example.test:magiclink"));
  assert.equal(coordinator.snapshot().user.id, id);
  await coordinator.logout();
  await api.forgotPassword({ email: "native@example.test" });
  await api.resetPassword({ email: "native@example.test", code: codes.get("native@example.test:recovery"), newPassword: "replacement password" });
  await assert.rejects(coordinator.login({ email: "native@example.test", password: "original password" }));
  await coordinator.login({ email: "native@example.test", password: "replacement password" });
  assert.equal(coordinator.snapshot().user.id, id);
  await coordinator.logout();
});

test("expired, foreign and mismatched sessions cannot authenticate", async () => {
  const account = await registered();
  const identity = [...identities.values()][0];
  const session = [...sessions.values()][0];
  session.notAfter = new Date(Date.now() - 1000);
  assert.equal((await request("/api/users/me", undefined, account.accessToken, "GET")).status, 401);
  session.notAfter = null;
  session.userId = randomUUID();
  assert.equal((await request("/api/users/me", undefined, account.accessToken, "GET")).status, 401);
  session.userId = identity.id;
  session.createdAt = new Date(Date.now() - 31 * 86400000);
  assert.equal((await request("/api/users/me", undefined, account.accessToken, "GET")).status, 401);
  session.createdAt = new Date();
  const forged = await new SignJWT({ session_id: session.id }).setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer).setAudience("authenticated").setSubject(identity.id).setIssuedAt().setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET));
  assert.equal((await request("/api/users/me", undefined, forged, "GET")).status, 401);
  identity.bannedUntil = new Date(Date.now() + 60000);
  assert.equal((await request("/api/users/me", undefined, account.accessToken, "GET")).status, 401);
});
