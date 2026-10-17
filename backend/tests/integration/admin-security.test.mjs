import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, beforeEach, after, mock, test } from "node:test";
import { spawnSync } from "node:child_process";
import { SignJWT, jwtVerify } from "jose";
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
  mock.module(new URL("../../src/lib/prisma.js", import.meta.url).href, { namedExports: { prisma: {
    sensorReading: { findFirst: async () => null, groupBy: async () => [] }, $runCommandRaw: async () => ({ ok: 1 }),
  } } });
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
  assert.equal(result.status, 200); return { ...result.body, id: user.id, updatedAt: user.updatedAt.toISOString(), cookie: result.headers.get("set-cookie").split(";")[0] };
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
  const health = await request("/api/admin/health", { method: "GET", token: result.body.accessToken });
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { postgres: "ok", mongo: "ok", api: "ok" });
  assert.equal((await request("/api/admin/stats", { method: "GET", token: result.body.accessToken })).status, 200);
  for (const [path, method, body] of [
    ["/api/admin/users?revealEmails=true", "GET"], ["/api/admin/audit", "GET"],
    [`/api/admin/devices?userId=${owner.id}`, "GET"],
    ["/api/admin/users", "POST", { email: "forbidden@example.test", password: "integration password", role: "ADMIN" }],
    [`/api/admin/users/${owner.id}`, "PATCH", { role: "ADMIN", updatedAt: owner.updatedAt.toISOString() }],
    [`/api/admin/users/${owner.id}`, "DELETE"],
  ]) {
    const denied = await request(path, { method, body, token: result.body.accessToken });
    assert.equal(denied.status, 403, `${method} ${path}`);
    assert.equal(denied.body.code, "FORBIDDEN");
  }
  assert.equal((await db.user.findUnique({ where: { id: owner.id } })).role, "USER");
});

test("real PostgreSQL: ADMIN needs OTP, unverified JWT is denied, and verified refresh retains authorization", async () => {
  const user = await account(); const raw = await issue(identities.get(user.supabaseUserId));
  const denied = await request("/api/admin/users", { method: "GET", token: raw.access_token });
  assert.equal(denied.status, 403); assert.equal(denied.body.code, "ADMIN_VERIFICATION_REQUIRED");
  for (const path of ["/api/admin/stats", "/api/admin/health"]) {
    const response = await request(path, { method: "GET", token: raw.access_token });
    assert.equal(response.status, 403); assert.equal(response.body.code, "ADMIN_VERIFICATION_REQUIRED");
  }
  const challenge = await login(user); assert.equal(challenge.status, 202); assert.equal(challenge.body.accessToken, undefined);
  const session = await request("/api/auth/verify-admin-otp", { body: { challengeToken: challenge.body.challengeToken, code: codes.get(user.email) } });
  assert.equal(session.status, 200);
  assert.doesNotMatch(session.headers.get("set-cookie"), /(?:^|;)\s*(?:Max-Age|Expires)=/i);
  assert.equal((await request("/api/admin/users", { method: "GET", token: session.body.accessToken })).status, 200);
  assert.equal(await db.adminSessionVerification.count(), 1);
  assert.equal(await db.auditLog.count({ where: { action: "ADMIN_LOGIN_VERIFIED" } }), 1);
  const refresh = await request("/api/auth/refresh", { body: {}, cookie: session.headers.get("set-cookie").split(";")[0] });
  assert.equal(refresh.status, 200);
  assert.doesNotMatch(refresh.headers.get("set-cookie"), /(?:^|;)\s*(?:Max-Age|Expires)=/i);
  assert.equal((await request("/api/admin/users", { method: "GET", token: refresh.body.accessToken })).status, 200);
});

for (const proofState of ["missing", "expired", "different session"]) {
  test(`real PostgreSQL: refreshed ADMIN JWT and further refresh require a ${proofState === "missing" ? "present" : "valid"} OTP proof (${proofState})`, async () => {
    const admin = await verified();
    const before = await db.adminSessionVerification.findFirst({ where: { userId: admin.id } });
    assert.ok(before);
    const refreshed = await request("/api/auth/refresh", { body: {}, cookie: admin.cookie });
    assert.equal(refreshed.status, 200);
    const claims = (await jwtVerify(refreshed.body.accessToken, signingKey, { issuer, audience: "authenticated" })).payload;
    assert.equal(claims.session_id, before.supabaseSessionId);
    const proof = await db.adminSessionVerification.findUnique({ where: { id: before.id } });
    assert.equal(proof.expiresAt.toISOString(), before.expiresAt.toISOString(), "refresh must not extend the OTP proof");
    assert.equal(proof.verifiedAt.toISOString(), before.verifiedAt.toISOString(), "refresh must not re-verify the session");
    assert.equal((await request("/api/admin/users", { method: "GET", token: refreshed.body.accessToken })).status, 200);
    if (proofState === "missing") await db.adminSessionVerification.deleteMany({ where: { id: proof.id } });
    else await db.adminSessionVerification.update({ where: { id: proof.id }, data: proofState === "expired"
      ? { expiresAt: new Date(Date.now() - 1) } : { supabaseSessionId: randomUUID() } });
    // The JWT is still signed and unexpired. Every admin route must re-check its proof.
    for (const path of ["users", "devices", "audit", "stats", "health"]) {
      const denied = await request(`/api/admin/${path}`, { method: "GET", token: refreshed.body.accessToken });
      assert.equal(denied.status, 403); assert.equal(denied.body.code, "ADMIN_VERIFICATION_REQUIRED");
    }
    const denied = await request("/api/auth/refresh", { body: {}, cookie: refreshed.headers.get("set-cookie").split(";")[0] });
    assert.equal(denied.status, 403); assert.equal(denied.body.code, "ADMIN_VERIFICATION_REQUIRED");
    assert.equal(denied.body.accessToken, undefined);
    assert.match(denied.headers.get("set-cookie"), /^__Host-leafcheck-refresh=;/);
  });
}

test("real PostgreSQL: SuperAdmin-created inactive users remain banned and cannot sign in", async () => {
  const admin = await verified();
  const created = await request("/api/admin/users", { token: admin.accessToken, body: {
    email: "initially-banned@example.test", password: "integration password", isActive: false,
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.isActive, false);
  const persisted = await db.user.findUnique({ where: { id: created.body.data.id } });
  assert.equal(persisted.isActive, false);
  assert.equal((await login(persisted)).status, 401);
  const audit = await db.auditLog.findFirst({ where: { targetId: persisted.id, action: "USER_CREATED" } });
  assert.equal(audit.metadata.isActive, false);
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
  const edited = await request(`/api/admin/users/${target.id}`, { token: admin.accessToken, method: "PATCH", body: { role: "ADMIN", updatedAt: target.updatedAt } });
  assert.equal(edited.status, 200);
  assert.equal((await request("/api/admin/devices", { method: "GET", token: oldSession.body.accessToken })).status, 401);
  assert.equal((await login(target)).status, 202);
  assert.equal(await db.auditLog.count({ where: { action: "USER_CREATED", targetId: target.id } }), 1);
  assert.equal(await db.auditLog.count({ where: { action: "USER_UPDATED", targetId: target.id } }), 1);
  failAudit = true;
  const failedUpdate = await request(`/api/admin/users/${target.id}`, { token: admin.accessToken, method: "PATCH", body: { name: "must roll back", updatedAt: edited.body.data.updatedAt } });
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

test("real PostgreSQL: stale edits cannot restore a revoked role and rejected writes have no audit", async () => {
  const first = await verified(), second = await verified(), target = await account("ADMIN");
  const path = `/api/admin/users/${target.id}`;
  const originalVersion = target.updatedAt.toISOString();
  const demoted = await request(path, { method: "PATCH", token: second.accessToken, body: { role: "USER", updatedAt: originalVersion } });
  assert.equal(demoted.status, 200);
  assert.notEqual(demoted.body.data.updatedAt, originalVersion);
  const stale = await request(path, { method: "PATCH", token: first.accessToken,
    body: { name: "A stale name edit", role: "ADMIN", updatedAt: originalVersion } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "CONFLICT");
  assert.equal(stale.body.error, "This user was modified by another administrator. Please refresh.");
  const persisted = await db.user.findUnique({ where: { id: target.id } });
  assert.equal(persisted.role, "USER");
  assert.equal(persisted.name, null);
  assert.equal(await db.auditLog.count({ where: { targetId: target.id, action: "USER_UPDATED" } }), 1);
  const renamed = await request(path, { method: "PATCH", token: first.accessToken,
    body: { name: "Reviewed name", updatedAt: demoted.body.data.updatedAt } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.role, "USER");
  for (const body of [{ name: "missing version" }, { name: "invalid version", updatedAt: "yesterday" }, { updatedAt: renamed.body.data.updatedAt }]) {
    assert.equal((await request(path, { method: "PATCH", token: first.accessToken, body })).status, 400);
  }
});

test("real PostgreSQL: only one concurrent update can use the same user version", async () => {
  const admin = await verified(), target = await account("USER");
  const results = await Promise.all(["First name", "Second name"].map(name => request(`/api/admin/users/${target.id}`, {
    method: "PATCH", token: admin.accessToken, body: { name, updatedAt: target.updatedAt.toISOString() },
  })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.status === 409).body.code, "CONFLICT");
  assert.equal(await db.auditLog.count({ where: { targetId: target.id, action: "USER_UPDATED" } }), 1);
});

test("real PostgreSQL: concurrent administrator demotions preserve one authorized SuperAdmin", async () => {
  const first = await verified(), second = await verified();
  const results = await Promise.all([
    request(`/api/admin/users/${second.id}`, { token: first.accessToken, method: "PATCH", body: { role: "LEAD_DEV", updatedAt: second.updatedAt } }),
    request(`/api/admin/users/${first.id}`, { token: second.accessToken, method: "PATCH", body: { role: "LEAD_DEV", updatedAt: first.updatedAt } }),
  ]);
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.ok(results.some(result => [401, 403, 409].includes(result.status)));
  assert.equal(await db.user.count({ where: { role: "ADMIN", isActive: true } }), 1);
});

test("real PostgreSQL: opt-in emails and audit identities retain deleted-account history", async () => {
  const admin = await verified(), target = await account("USER");
  const event = await db.auditLog.create({ data: {
    actorId: target.id, targetId: admin.id, action: "HISTORIC_EVENT", metadata: { actorId: target.id },
  } });
  const masked = await request("/api/admin/users", { method: "GET", token: admin.accessToken });
  assert.equal(masked.status, 200);
  assert.ok(masked.body.data.every(row => !("email" in row)));
  const revealed = await request("/api/admin/users?revealEmails=true", { method: "GET", token: admin.accessToken });
  assert.equal(revealed.body.data.find(row => row.id === target.id).email, target.email);
  const history = () => request("/api/admin/audit?action=HISTORIC_EVENT", { method: "GET", token: admin.accessToken });
  const before = await history();
  assert.equal(before.status, 200);
  assert.equal(before.body.data[0].actorEmail, target.email);
  assert.equal(before.body.data[0].targetEmail, admin.user.email);
  assert.equal((await request(`/api/admin/users/${target.id}`, { method: "DELETE", token: admin.accessToken })).status, 204);
  const after = await history();
  assert.equal(after.body.data[0].id, event.id);
  assert.equal(after.body.data[0].actorEmail, null);
  assert.equal(after.body.data[0].actorId, null);
  assert.equal(after.body.data[0].metadata.actorId, target.id);
  assert.equal(after.body.data[0].targetEmail, admin.user.email);
});
