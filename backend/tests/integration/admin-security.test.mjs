import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, mock, test } from "node:test";
import { spawnSync } from "node:child_process";
import { SignJWT } from "jose";
import express from "express";
import { PrismaClient } from "../../src/generated/postgres-client/index.js";

// Never connect, let alone delete fixtures, without proving this is our local container.
const url = new URL(process.env.POSTGRES_URL ?? "http://invalid.test");
const container = process.env.LEAFCHECK_ADMIN_SECURITY_TEST_CONTAINER ?? "";
assert.equal(url.hostname, "127.0.0.1");
assert.match(container, /^leafcheck-admin-security-[a-f0-9-]{36}$/);
const label = spawnSync("docker", ["inspect", "--format", '{{index .Config.Labels "leafcheck.admin-security"}}', container], { encoding: "utf8" });
assert.equal(label.status, 0);
assert.equal(label.stdout.trim(), container.slice("leafcheck-admin-security-".length));

Object.assign(process.env, {
  AUTH_PROVIDER: "supabase", AUTH_JWT_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM",
  AUTH_JWT_ISSUER: "admin-integration", AUTH_JWT_AUDIENCE: "admin-integration",
  AUTH_ALLOWED_ORIGINS: "https://admin.example.test", SUPABASE_URL: "https://provider.example.test",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable", SUPABASE_SECRET_KEY: "test-secret",
});
const db = new PrismaClient({ log: [] });
const identities = new Map(), sessions = new Map(), tokens = new Map(), codes = new Map();
const signingKey = new TextEncoder().encode("integration-provider-test-signing-key");
const issuer = "https://provider.example.test/auth/v1";
const network = globalThis.fetch;
let server, base, pauseVerification, failProviderDeletion = false, failAudit = false;
const guardedDb = new Proxy(db, { get(target, key) {
  if (key === "$transaction") return (operation, options) => target.$transaction(tx => operation(new Proxy(tx, { get(transaction, model) {
    if (model !== "auditLog") return Reflect.get(transaction, model);
    return new Proxy(transaction.auditLog, { get(delegate, method) {
      if (method === "create" && failAudit) return async () => { throw new Error("simulated audit failure"); };
      const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value;
    } });
  } })), options);
  const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
} });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
async function issue(identity, id = randomUUID()) {
  if (!sessions.has(id)) sessions.set(id, { id, userId: identity.id, createdAt: new Date(), notAfter: null });
  const access_token = await new SignJWT({ session_id: id }).setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.id).setIssuer(issuer).setAudience("authenticated").setIssuedAt().setExpirationTime("15m").sign(signingKey);
  const refresh_token = randomUUID();
  tokens.set(access_token, identity); tokens.set(refresh_token, id);
  return { access_token, refresh_token, expires_in: 900 };
}
const serialize = identity => ({ id: identity.id, email: identity.email, email_confirmed_at: identity.emailConfirmedAt.toISOString(), user_metadata: { name: "Staff" } });

before(async () => {
  mock.module(new URL("../../src/lib/prisma-pg.js", import.meta.url).href, { namedExports: { prismaPg: guardedDb } });
  mock.module(new URL("../../src/lib/prisma-auth-read.js", import.meta.url).href, { namedExports: { authRead: {
    session: async id => sessions.get(id) ?? null,
    sessions: async id => [...sessions.values()].filter(row => row.userId === id),
    user: async id => identities.get(id) ?? null,
  } } });
  mock.module(new URL("../../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: { sensorReading: { findFirst: async () => null } } } });
  mock.method(globalThis, "fetch", async (input, init = {}) => {
    const parsed = new URL(input);
    if (parsed.origin !== "https://provider.example.test") return network(input, init);
    const path = parsed.pathname.slice("/auth/v1".length);
    const body = init.body ? JSON.parse(init.body) : {};
    const bearer = new Headers(init.headers).get("authorization")?.slice(7);
    if (path === "/user") return tokens.has(bearer) ? json(serialize(tokens.get(bearer))) : json({}, 401);
    if (path === "/token") {
      if (parsed.searchParams.get("grant_type") === "refresh_token") {
        const id = tokens.get(body.refresh_token), session = sessions.get(id);
        return session ? json(await issue(identities.get(session.userId), id)) : json({}, 400);
      }
      const identity = [...identities.values()].find(row => row.email === body.email && body.password === "integration password");
      return identity ? json(await issue(identity)) : json({}, 400);
    }
    if (path === "/otp") { codes.set(body.email, "00123456"); return json({}); }
    if (path === "/verify") {
      if (!codes.has(body.email) || codes.get(body.email) !== body.token) return json({}, 400);
      codes.delete(body.email);
      if (pauseVerification) await pauseVerification();
      return json(await issue([...identities.values()].find(row => row.email === body.email)));
    }
    if (path === "/logout") {
      const identity = tokens.get(bearer);
      for (const [id, session] of sessions) if (session.userId === identity.id) sessions.delete(id);
      return new Response(null, { status: 204 });
    }
    if (path.startsWith("/admin/users/") && init.method === "DELETE") {
      if (failProviderDeletion) return json({}, 503);
      const id = path.slice("/admin/users/".length);
      identities.delete(id);
      for (const [sid, session] of sessions) if (session.userId === id) sessions.delete(sid);
      return json({});
    }
    if (path === "/admin/users" && init.method === "POST") {
      const identity = { id: randomUUID(), email: body.email, emailConfirmedAt: new Date(), bannedUntil: null };
      identities.set(identity.id, identity); return json(serialize(identity));
    }
    throw new Error("Unexpected mock provider operation");
  });
  const { authRouter } = await import("../../src/routes/auth.ts");
  const { adminRouter, adminErrorHandler } = await import("../../src/routes/admin.ts");
  const { errorHandler } = await import("../../src/lib/http.ts");
  const app = express(); app.use(express.json()); app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter, adminErrorHandler); app.use(errorHandler);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  pauseVerification = null; failProviderDeletion = false; failAudit = false;
  await db.auditLog.deleteMany(); await db.user.deleteMany();
  identities.clear(); sessions.clear(); tokens.clear(); codes.clear();
});
after(async () => { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); mock.restoreAll(); });

async function account(role = "ADMIN") {
  const identity = { id: randomUUID(), email: `${randomUUID()}@example.test`, emailConfirmedAt: new Date(), bannedUntil: null };
  identities.set(identity.id, identity);
  return db.user.create({ data: { email: identity.email, password: "unusable legacy hash", role,
    supabaseUserId: identity.id, emailVerifiedAt: identity.emailConfirmedAt } });
}
async function request(path, { body, token, method = "POST", cookie } = {}) {
  const response = await network(base + path, { method, headers: {
    Origin: "https://admin.example.test", "X-CSRF-Protection": "1", "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
}
const login = user => request("/api/auth/login", { body: { email: user.email, password: "integration password" } });
async function verified() {
  const user = await account(); const challenge = await login(user); assert.equal(challenge.status, 202);
  const result = await request("/api/auth/verify-admin-otp", { body: { challengeToken: challenge.body.challengeToken, code: codes.get(user.email) } });
  assert.equal(result.status, 200); return { ...result.body, id: user.id, cookie: result.headers.get("set-cookie").split(";")[0] };
}

test("real PostgreSQL: LEAD_DEV receives a JWT, cannot read users, and receives no owner identity", async () => {
  const lead = await account("LEAD_DEV"), owner = await account("USER");
  await db.device.create({ data: { name: "Sensor", macAddress: "LC-A50528", userId: owner.id } });
  const result = await login(lead); assert.equal(result.status, 200);
  const users = await request("/api/admin/users", { method: "GET", token: result.body.accessToken });
  assert.equal(users.status, 403); assert.equal(users.body.code, "FORBIDDEN");
  const devices = await request("/api/admin/devices", { method: "GET", token: result.body.accessToken });
  assert.equal(devices.status, 200); assert.equal(devices.body.data.length, 1);
  assert.equal("owner" in devices.body.data[0], false);
  assert.ok(!JSON.stringify(devices.body).includes(owner.email));
});

test("real PostgreSQL: ADMIN needs OTP, unverified JWT is denied, and verified refresh retains authorization", async () => {
  const user = await account(); const raw = await issue(identities.get(user.supabaseUserId));
  const denied = await request("/api/admin/users", { method: "GET", token: raw.access_token });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, "ADMIN_VERIFICATION_REQUIRED");
  const challenge = await login(user); assert.equal(challenge.status, 202); assert.equal(challenge.body.accessToken, undefined);
  const session = await request("/api/auth/verify-admin-otp", { body: { challengeToken: challenge.body.challengeToken, code: codes.get(user.email) } });
  assert.equal(session.status, 200);
  assert.equal((await request("/api/admin/users", { method: "GET", token: session.body.accessToken })).status, 200);
  assert.equal(await db.adminSessionVerification.count(), 1);
  assert.equal(await db.auditLog.count({ where: { action: "ADMIN_LOGIN_VERIFIED" } }), 1);
  const refresh = await request("/api/auth/refresh", { body: {}, cookie: session.headers.get("set-cookie").split(";")[0] });
  assert.equal(refresh.status, 200);
  assert.equal((await request("/api/admin/users", { method: "GET", token: refresh.body.accessToken })).status, 200);
});

test("real PostgreSQL: concurrent challenge issuance is limited and verification consumes once", async () => {
  const user = await account();
  const starts = await Promise.all([login(user), login(user)]);
  assert.deepEqual(starts.map(row => row.status).sort(), [202, 429]);
  const challenge = starts.find(row => row.status === 202);
  const body = { challengeToken: challenge.body.challengeToken, code: codes.get(user.email) };
  const results = await Promise.all([request("/api/auth/verify-admin-otp", { body }), request("/api/auth/verify-admin-otp", { body })]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 400]);
  assert.equal(await db.adminSessionVerification.count(), 1);
});

test("real PostgreSQL: cancellation during upstream verification cannot create a verified session", async () => {
  const user = await account(), challenge = await login(user);
  let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  pauseVerification = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const verifying = request("/api/auth/verify-admin-otp", { body: { challengeToken: challenge.body.challengeToken, code: codes.get(user.email) } });
  await waiting;
  assert.equal((await request("/api/auth/admin-otp/cancel", { body: { challengeToken: challenge.body.challengeToken } })).status, 204);
  release(); assert.equal((await verifying).status, 400);
  assert.equal(await db.adminSessionVerification.count(), 0);
});

test("real PostgreSQL: CRUD audits are transactional and role changes invalidate existing sessions", async () => {
  const admin = await verified();
  const created = await request("/api/admin/users", { token: admin.accessToken, body: { email: "created@example.test", password: "integration password", role: "LEAD_DEV" } });
  assert.equal(created.status, 201); const target = created.body.data;
  const oldSession = await login(target); assert.equal(oldSession.status, 200);
  const edited = await request(`/api/admin/users/${target.id}`, { token: admin.accessToken, method: "PATCH", body: { role: "ADMIN" } });
  assert.equal(edited.status, 200);
  assert.equal((await request("/api/admin/devices", { method: "GET", token: oldSession.body.accessToken })).status, 401);
  assert.equal((await login(target)).status, 202);
  assert.equal(await db.auditLog.count({ where: { action: "USER_CREATED", targetId: target.id } }), 1);
  assert.equal(await db.auditLog.count({ where: { action: "USER_UPDATED", targetId: target.id } }), 1);
  failAudit = true;
  const failedUpdate = await request(`/api/admin/users/${target.id}`, { token: admin.accessToken, method: "PATCH", body: { name: "must roll back" } });
  assert.equal(failedUpdate.status, 503);
  assert.equal((await db.user.findUnique({ where: { id: target.id } })).name, null);
  const failedCreation = await request("/api/admin/users", { token: admin.accessToken, body: {
    email: "rollback@example.test", password: "integration password",
  } });
  assert.equal(failedCreation.status, 503);
  assert.equal(await db.user.findUnique({ where: { email: "rollback@example.test" } }), null);
  assert.ok(![...identities.values()].some(identity => identity.email === "rollback@example.test"));
});

test("real PostgreSQL: deletion preserves historical audits and provider failures leave accounts disabled", async () => {
  const admin = await verified(), target = await account("ADMIN");
  await db.auditLog.create({ data: { actorId: target.id, action: "HISTORIC_EVENT", metadata: { actorId: target.id } } });
  failProviderDeletion = true;
  const failed = await request(`/api/admin/users/${target.id}`, { token: admin.accessToken, method: "DELETE" });
  assert.equal(failed.status, 503); assert.equal(failed.body.code, "USER_DELETE_PENDING");
  assert.equal((await db.user.findUnique({ where: { id: target.id } })).isActive, false);
  failProviderDeletion = false;
  assert.equal((await request(`/api/admin/users/${target.id}`, { token: admin.accessToken, method: "DELETE" })).status, 204);
  assert.equal(await db.user.findUnique({ where: { id: target.id } }), null);
  const event = await db.auditLog.findFirst({ where: { action: "HISTORIC_EVENT" } });
  assert.equal(event.actorId, null); assert.equal(event.metadata.actorId, target.id);
});

test("real PostgreSQL: concurrent administrator demotions preserve one authorized SuperAdmin", async () => {
  const first = await verified(), second = await verified();
  const results = await Promise.all([
    request(`/api/admin/users/${second.id}`, { token: first.accessToken, method: "PATCH", body: { role: "LEAD_DEV" } }),
    request(`/api/admin/users/${first.id}`, { token: second.accessToken, method: "PATCH", body: { role: "LEAD_DEV" } }),
  ]);
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.ok(results.some(result => [401, 403, 409].includes(result.status)));
  assert.equal(await db.user.count({ where: { role: "ADMIN", isActive: true } }), 1);
});
