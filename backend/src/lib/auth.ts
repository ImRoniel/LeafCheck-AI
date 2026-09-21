import argon2 from "argon2";
import { jwtVerify, SignJWT } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { User } from "../generated/postgres-client/index.js";
import { authConfig } from "./auth-config.js";
import { asyncRoute, HttpError } from "./http.js";
import { prismaPg } from "./prisma-pg.js";

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
const dummyHash = hashPassword(randomBytes(32).toString("base64url"));
export async function verifyPassword(password: string, stored?: string) {
  const supported = stored?.startsWith("$argon2id$") === true;
  try {
    const valid = await argon2.verify(
      supported ? stored! : await dummyHash,
      password,
    );
    return supported && valid;
  } catch {
    return false;
  }
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const opaqueToken = () => randomBytes(32).toString("base64url");
export const invalidSession = () =>
  new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
export const safeUser = (user: User) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
export async function accessToken(userId: string, sessionId: string) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(authConfig.issuer)
    .setAudience(authConfig.audience)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(authConfig.key);
}
export async function createSession(userId: string, client: string) {
  const refreshToken = opaqueToken();
  const session = await prismaPg.authSession.create({
    data: {
      userId,
      client,
      expiresAt: new Date(Date.now() + SESSION_MS),
      refreshTokens: { create: { tokenHash: tokenHash(refreshToken) } },
    },
  });
  return {
    accessToken: await accessToken(userId, session.id),
    refreshToken,
    expiresIn: 900,
  };
}
export async function rotateSession(token: string, client: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidSession();
  const refreshToken = opaqueToken();
  const result = await prismaPg.$transaction(async (tx) => {
    const record = await tx.refreshToken.findUnique({
      where: { tokenHash: tokenHash(token) },
    });
    if (!record) return null;
    // Serialize refresh, logout and logout-all on the session row. A concurrent
    // replay waits, sees consumedAt and commits revocation (never throws inside).
    await tx.$queryRaw`SELECT "id" FROM "AuthSession" WHERE "id" = ${record.sessionId} FOR UPDATE`;
    const session = await tx.authSession.findUnique({
      where: { id: record.sessionId },
      include: { user: true },
    });
    if (
      !session ||
      session.client !== client ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    )
      return null;
    const consumed = await tx.refreshToken.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      await tx.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    await tx.refreshToken.create({
      data: { sessionId: session.id, tokenHash: tokenHash(refreshToken) },
    });
    return { userId: session.userId, sessionId: session.id };
  });
  if (!result) throw invalidSession();
  return {
    accessToken: await accessToken(result.userId, result.sessionId),
    refreshToken,
    expiresIn: 900,
  };
}
export const requireAuth = asyncRoute(async (req, res, next) => {
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(
    req.get("authorization") ?? "",
  );
  if (!match || match[1].length > 2048) throw invalidSession();
  let claims;
  try {
    claims = (
      await jwtVerify(match[1], authConfig.key, {
        algorithms: ["HS256"],
        issuer: authConfig.issuer,
        audience: authConfig.audience,
        requiredClaims: ["sub", "sid", "exp", "iat"],
        maxTokenAge: "15m",
        typ: "JWT",
      })
    ).payload;
  } catch {
    throw invalidSession();
  }
  if (typeof claims.sub !== "string" || typeof claims.sid !== "string")
    throw invalidSession();
  const session = await prismaPg.authSession.findUnique({
    where: { id: claims.sid },
    include: { user: true },
  });
  if (
    !session ||
    session.userId !== claims.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    !session.user.isActive
  )
    throw invalidSession();
  res.locals.auth = { user: session.user, sessionId: session.id };
  res.set("Cache-Control", "no-store");
  next();
});
