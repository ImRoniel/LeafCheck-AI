import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import "tsx/cjs";

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
const preservedId = "2da2cd1a-e594-43cc-a165-552342882246";
let server, base, network, sequence = 10000000, upstreamCalls = [], asymmetric, publicJwk;
let algorithm = "HS256", refuseRevocation = false, autoConfirm = false;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const db = {
  user: {
    findUnique: async ({ where }) => [...users.values()].find(user =>
      where.id ? user.id === where.id : where.email ? user.email === where.email : user.supabaseUserId === where.supabaseUserId) ?? null,
    create: async ({ data }) => {
      if ([...users.values()].some(user => user.email === data.email || user.supabaseUserId === data.supabaseUserId)) throw { code: "P2002" };
      const user = { ...data, id: randomUUID(), isActive: true, createdAt: new Date(), updatedAt: new Date() };
      users.set(user.id, user);
      return user;
    },
  },
  // Provider auth must not write either legacy table.
  authSession: { create() { throw new Error("Legacy session write forbidden"); }, updateMany() { throw new Error("Legacy revocation forbidden"); } },
  refreshToken: { create() { throw new Error("Legacy token write forbidden"); }, deleteMany() { throw new Error("Legacy token deletion forbidden"); } },
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
  assert.equal(headers.get("apikey"), path === "/logout" ? "sb_secret_test" : "sb_publishable_test");
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
    if (identity) sendCode(body.email, path === "/recover" ? "recovery" : path === "/resend" ? "signup" : "email");
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
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
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
  const result = await request("/otp/verify", { email, code: codes.get(`${email}:signup`), purpose: "registration" });
  assert.equal(result.status, 200);
  return result.body;
}

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
  assert.equal((await request("/otp/verify", { email: "new@example.test", code: "00000000", purpose: "registration" })).status, 400);
  const code = "00123456";
  codes.set("new@example.test:signup", code);
  const verified = await request("/otp/verify", { email: "new@example.test", code, purpose: "registration" });
  assert.equal(verified.status, 200);
  assert.equal(users.size, 2);
  const user = users.get(verified.body.user.id);
  assert.equal(user.role, "USER");
  assert.ok(user.supabaseUserId);
  assert.ok(user.emailVerifiedAt instanceof Date);
  assert.equal(await (await import("../src/lib/password.ts")).verifyPassword("original password", user.password), false);
  assert.equal((await request("/otp/verify", { email: user.email, code, purpose: "registration" })).status, 400);
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
    ["/otp/verify", { email: "person@example.test", purpose: "registration" }],
    ["/otp/verify", { email: "person@example.test", purpose: "login" }],
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
  const invalidKnown = await request("/otp/verify", { email: account.user.email, code: "00000000", purpose: "login" });
  const invalidUnknown = await request("/otp/verify", { email: "unknown@example.test", code: "00000000", purpose: "login" });
  assert.deepEqual(invalidKnown.body, invalidUnknown.body);
  const code = codes.get(`${account.user.email}:email`);
  const login = await request("/otp/verify", { email: account.user.email, code, purpose: "login" });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, account.user.id);
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
  const result = await request("/otp/verify", { email: before.email, code: codes.get(`${before.email}:signup`), purpose: "registration" });
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
  await coordinator.verifyOtp(codes.get("native@example.test:email"));
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
