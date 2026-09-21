import express from "express";
import { SignJWT } from "jose";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";

process.env.AUTH_JWT_SECRET =
  "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM";
process.env.AUTH_JWT_ISSUER = "test-issuer";
process.env.AUTH_JWT_AUDIENCE = "test-audience";
process.env.AUTH_ALLOWED_ORIGINS = "https://example.test";
const users = new Map(),
  sessions = new Map(),
  tokens = new Map();
const db = {
  user: {
    create: async ({ data }) => {
      if ([...users.values()].some((u) => u.email === data.email))
        throw { code: "P2002" };
      const user = {
        ...data,
        id: randomUUID(),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      users.set(user.id, user);
      return user;
    },
    findUnique: async ({ where }) =>
      [...users.values()].find((u) => u.email === where.email),
    update: async ({ where, data }) => Object.assign(users.get(where.id), data),
  },
  authSession: {
    create: async ({ data }) => {
      const session = { ...data, id: randomUUID(), revokedAt: null };
      sessions.set(session.id, session);
      await db.refreshToken.create({
        data: { sessionId: session.id, ...data.refreshTokens.create },
      });
      return session;
    },
    findUnique: async ({ where }) => {
      const s = sessions.get(where.id);
      return s ? { ...s, user: users.get(s.userId) } : null;
    },
    update: async ({ where, data }) =>
      Object.assign(sessions.get(where.id), data),
    updateMany: async ({ where, data }) => {
      for (const s of sessions.values())
        if (
          (!where.id || s.id === where.id) &&
          (!where.userId || s.userId === where.userId)
        )
          Object.assign(s, data);
      return { count: 1 };
    },
  },
  refreshToken: {
    create: async ({ data }) => {
      const token = { ...data, id: randomUUID(), consumedAt: null };
      tokens.set(token.tokenHash, token);
      return token;
    },
    findUnique: async ({ where }) => tokens.get(where.tokenHash),
    updateMany: async ({ where, data }) => {
      const token = [...tokens.values()].find(
        (t) => t.id === where.id && t.consumedAt === null,
      );
      if (!token) return { count: 0 };
      Object.assign(token, data);
      return { count: 1 };
    },
  },
  $queryRaw: async () => [],
};
let queue = Promise.resolve();
db.$transaction = (callback) => {
  const result = queue.then(() => callback(db));
  queue = result.catch(() => {});
  return result;
};
let server, base, auth;
before(async () => {
  mock.module(new URL("../src/lib/prisma-pg.js", import.meta.url).href, {
    namedExports: { prismaPg: db },
  });
  const { authRouter } = await import("../src/routes/auth.ts");
  const { usersRouter } = await import("../src/routes/users.ts");
  const { errorHandler } = await import("../src/lib/http.ts");
  auth = await import("../src/lib/auth.ts");
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/auth", authRouter);
  app.use("/users", usersRouter);
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  mock.restoreAll();
});
async function request(path, body, headers = {}, method = "POST") {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Client": "native",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: res.status === 204 ? null : await res.json(),
  };
}
const password = "  fifteen characters plus spaces  ";
const register = (email) =>
  request("/auth/register", { email, password, name: " Test " });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

test("registration normalizes email, hashes exact password, rejects privileged fields and duplicates", async () => {
  assert.equal(
    (
      await request("/auth/register", {
        email: "x@example.test",
        password,
        role: "ADMIN",
      })
    ).status,
    400,
  );
  const result = await register("  Owner@Example.test  ");
  assert.equal(result.status, 201);
  assert.equal(result.body.user.email, "owner@example.test");
  assert.equal(result.body.user.role, "USER");
  assert.equal(result.body.user.password, undefined);
  const user = users.get(result.body.user.id);
  assert.ok(user.password.startsWith("$argon2id$"));
  assert.equal(await auth.verifyPassword(password, user.password), true);
  assert.equal(
    await auth.verifyPassword(password.trim(), user.password),
    false,
  );
  assert.equal((await register("OWNER@example.test")).status, 409);
  assert.equal(
    (
      await request("/auth/register", {
        email: "short@example.test",
        password: "short",
      })
    ).status,
    400,
  );
});
test("registration and login accept 8–128 characters and reject out-of-range passwords", async () => {
  for (const length of [8, 128]) {
    const body = {
      email: `length-${length}@example.test`,
      password: "x".repeat(length),
    };
    assert.equal((await request("/auth/register", body)).status, 201);
    const login = await request("/auth/login", body);
    assert.equal(login.status, 200);
    assert.ok(login.body.accessToken);
    assert.ok(login.body.refreshToken);
  }
  for (const length of [7, 129]) {
    for (const path of ["/auth/register", "/auth/login"]) {
      const result = await request(path, {
        email: `invalid-${length}@example.test`,
        password: "x".repeat(length),
      });
      assert.equal(result.status, 400);
      assert.equal(
        result.body.error,
        "Valid email and a password of 8–128 characters are required.",
      );
    }
  }
});
test("unknown and wrong-password login have the same generic response", async () => {
  const unknown = await request("/auth/login", {
    email: "missing@example.test",
    password,
  });
  const wrong = await request("/auth/login", {
    email: "owner@example.test",
    password: "wrong password long enough",
  });
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.body, wrong.body);
});
test("rotation stores only hashes; replay revokes replacement access and refresh", async () => {
  const first = (await register("rotate@example.test")).body;
  assert.equal(
    [...tokens.values()].some((t) =>
      JSON.stringify(t).includes(first.refreshToken),
    ),
    false,
  );
  const next = await request("/auth/refresh", {
    refreshToken: first.refreshToken,
  });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.refreshToken, first.refreshToken);
  assert.equal(
    (await request("/auth/refresh", { refreshToken: first.refreshToken }))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        "/users/me",
        undefined,
        bearer(next.body.accessToken),
        "GET",
      )
    ).status,
    401,
  );
  assert.equal(
    (await request("/auth/refresh", { refreshToken: next.body.refreshToken }))
      .status,
    401,
  );
});
test("concurrent refresh permits one consume then revokes the session on replay", async () => {
  const first = (await register("race@example.test")).body;
  const results = await Promise.all(
    [1, 2].map(() =>
      request("/auth/refresh", { refreshToken: first.refreshToken }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const winner = results.find((r) => r.status === 200);
  assert.equal(
    (
      await request(
        "/users/me",
        undefined,
        bearer(winner.body.accessToken),
        "GET",
      )
    ).status,
    401,
  );
});
test("profile allowlist, logout, logout-all and inactive users", async () => {
  const first = (await register("logout@example.test")).body;
  const second = (
    await request("/auth/login", { email: "logout@example.test", password })
  ).body;
  assert.equal(
    (
      await request(
        "/users/me",
        { role: "ADMIN" },
        bearer(first.accessToken),
        "PATCH",
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/users/me",
        { name: "New" },
        bearer(first.accessToken),
        "PATCH",
      )
    ).body.name,
    "New",
  );
  assert.equal(
    (await request("/auth/logout", {}, bearer(first.accessToken))).status,
    204,
  );
  assert.equal(
    (await request("/users/me", undefined, bearer(first.accessToken), "GET"))
      .status,
    401,
  );
  assert.equal(
    (await request("/users/me", undefined, bearer(second.accessToken), "GET"))
      .status,
    200,
  );
  assert.equal(
    (await request("/auth/logout-all", {}, bearer(second.accessToken))).status,
    204,
  );
  assert.equal(
    (await request("/users/me", undefined, bearer(second.accessToken), "GET"))
      .status,
    401,
  );
  const active = (await register("inactive@example.test")).body;
  users.get(active.user.id).isActive = false;
  assert.equal(
    (await request("/users/me", undefined, bearer(active.accessToken), "GET"))
      .status,
    401,
  );
});
test("JWT issuer, audience, algorithm, expiry and signature are enforced", async () => {
  const first = (await register("jwt@example.test")).body;
  const session = [...sessions.values()].find(
    (s) => s.userId === first.user.id,
  );
  for (const change of [
    { issuer: "bad" },
    { audience: "bad" },
    { alg: "HS384" },
    { expiry: "-1s" },
    { key: "another-key-that-is-not-the-signing-key" },
  ]) {
    const jwt = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: change.alg ?? "HS256", typ: "JWT" })
      .setSubject(first.user.id)
      .setIssuer(change.issuer ?? "test-issuer")
      .setAudience(change.audience ?? "test-audience")
      .setIssuedAt()
      .setExpirationTime(change.expiry ?? "15m")
      .sign(
        new TextEncoder().encode(change.key ?? process.env.AUTH_JWT_SECRET),
      );
    assert.equal(
      (await request("/users/me", undefined, bearer(jwt), "GET")).status,
      401,
    );
  }
});
test("browser refresh is cookie-only with secure attributes and explicit origin/CSRF checks", async () => {
  const headers = { Origin: "https://example.test", "X-CSRF-Protection": "1" };
  const result = await request(
    "/auth/register",
    { email: "browser@example.test", password },
    headers,
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.refreshToken, undefined);
  const cookie = result.headers.get("set-cookie");
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"])
    assert.ok(cookie.includes(attribute));
  const cookieHeader = cookie.split(";")[0];
  assert.equal(
    (await request("/auth/refresh", {}, { ...headers, Cookie: cookieHeader }))
      .status,
    200,
  );
  assert.equal(
    (await request("/auth/refresh", { refreshToken: "x" }, headers)).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/auth/login",
        { email: "browser@example.test", password },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/auth/login",
        { email: "browser@example.test", password },
        { Origin: "https://example.test" },
      )
    ).status,
    403,
  );
});
