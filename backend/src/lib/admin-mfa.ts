import { createHash, randomBytes } from "node:crypto";
import type { AdminChallenge, User } from "../generated/postgres-client/index.js";
import { writeAudit } from "./audit.js";
import { securityTransaction } from "./admin-verification.js";
import { HttpError } from "./http.js";
import { prismaPg } from "./prisma-pg.js";
import { ProviderError, supabaseAdmin, supabasePublic } from "./supabase-client.js";
import { providerSession } from "./supabase-session.js";

export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const invalidChallenge = () => new HttpError(400, "INVALID_CHALLENGE", "This sign-in challenge is invalid or expired. Sign in again.");
const invalidCode = () => new HttpError(400, "INVALID_CODE", "Invalid or expired code. Request a new one.");

export interface ChallengeContext {
  client: "browser" | "native";
  origin: string | null;
  ipAddress?: string;
}

function hashChallenge(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw invalidChallenge();
  return createHash("sha256").update(value).digest("hex");
}

function eligible(challenge: AdminChallenge, user: User, context: ChallengeContext): boolean {
  return challenge.consumedAt === null && challenge.expiresAt > new Date() &&
    challenge.client === context.client && challenge.origin === context.origin &&
    user.isActive && user.role === "ADMIN" && user.email === challenge.email &&
    user.supabaseUserId === challenge.supabaseUserId && user.authVersion === challenge.authVersion;
}

async function pending(token: unknown, context: ChallengeContext) {
  const record = await prismaPg.adminChallenge.findUnique({ where: { challengeHash: hashChallenge(token) }, include: { user: true } });
  if (!record || !eligible(record, record.user, context) || record.attempts >= record.maxAttempts) throw invalidChallenge();
  return record;
}

export async function beginAdminChallenge(user: User, context: ChallengeContext) {
  const challengeToken = randomBytes(32).toString("base64url");
  const challenge = await securityTransaction(async tx => {
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current?.isActive || current.role !== "ADMIN" || !current.supabaseUserId ||
        current.authVersion !== user.authVersion || current.email !== user.email ||
        current.supabaseUserId !== user.supabaseUserId) throw invalidChallenge();
    const recent = await tx.adminChallenge.findFirst({ where: { userId: user.id }, orderBy: { lastSentAt: "desc" } });
    if ((recent && recent.lastSentAt.getTime() > Date.now() - RESEND_MS) ||
        await tx.adminChallenge.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) } } }) >= 5)
      throw new HttpError(429, "RATE_LIMITED", "Please wait before starting another sign-in challenge.");
    await tx.adminChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } });
    const record = await tx.adminChallenge.create({ data: {
      userId: user.id, email: user.email, supabaseUserId: current.supabaseUserId,
      challengeHash: hashChallenge(challengeToken), expiresAt: new Date(Date.now() + CHALLENGE_MS),
      authVersion: current.authVersion, client: context.client, origin: context.origin,
    } });
    await writeAudit({ actorId: user.id, ipAddress: context.ipAddress }, "ADMIN_OTP_REQUESTED", user.id, {}, tx);
    return record;
  });
  try { await supabasePublic.requestLoginCode(challenge.email); }
  catch (error) {
    await prismaPg.adminChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
    throw error;
  }
  const at = user.email.lastIndexOf("@");
  return { status: "otp_required" as const, challengeToken,
    maskedEmail: `${user.email[0]}***${user.email.slice(at)}`,
    expiresAt: challenge.expiresAt.toISOString(), resendAfter: RESEND_MS / 1000 };
}

export async function verifyAdminOtp(token: unknown, code: unknown, context: ChallengeContext) {
  if (typeof code !== "string" || !/^\d{8}$/.test(code))
    throw new HttpError(400, "INVALID_INPUT", "Enter the eight-digit email code.");
  const challenge = await pending(token, context);
  const reserved = await prismaPg.adminChallenge.updateMany({ where: {
    id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: challenge.maxAttempts },
  }, data: { attempts: { increment: 1 } } });
  if (reserved.count !== 1) throw invalidChallenge();
  let tokens;
  try { tokens = await supabasePublic.verify(challenge.email, code, "magiclink"); }
  catch (error) {
    await writeAudit({ actorId: challenge.userId, ipAddress: context.ipAddress }, "ADMIN_OTP_FAILED", challenge.userId);
    if (error instanceof ProviderError && error.status === 400) throw invalidCode();
    throw error;
  }
  try {
    const live = await providerSession(tokens.accessToken);
    if (live.identity.id !== challenge.supabaseUserId || live.identity.email !== challenge.email) throw invalidCode();
    const user = await securityTransaction(async tx => {
      const current = await tx.adminChallenge.findUnique({ where: { id: challenge.id }, include: { user: true } });
      if (!current || !eligible(current, current.user, context)) throw invalidChallenge();
      const consumed = await tx.adminChallenge.updateMany({ where: {
        id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() },
      }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw invalidChallenge();
      const verifiedAt = new Date();
      await tx.adminSessionVerification.create({ data: {
        userId: current.userId, supabaseSessionId: live.sessionId,
        verifiedAt, expiresAt: new Date(verifiedAt.getTime() + ADMIN_SESSION_MS), authVersion: current.authVersion,
      } });
      await writeAudit({ actorId: current.userId, ipAddress: context.ipAddress }, "ADMIN_LOGIN_VERIFIED", current.userId,
        { method: "password_and_email_otp" }, tx);
      return current.user;
    });
    return { tokens, user };
  } catch (error) {
    // A cancelled/losing verification must never leave an authorized session.
    await supabaseAdmin.logout(tokens.accessToken, "local").catch(() => {});
    throw error;
  }
}

export async function resendAdminOtp(token: unknown, context: ChallengeContext) {
  const challenge = await pending(token, context);
  const cutoff = new Date(Date.now() - RESEND_MS);
  if (challenge.lastSentAt > cutoff)
    throw new HttpError(429, "RATE_LIMITED", "Wait 60 seconds before requesting another code.");
  const reserved = await prismaPg.adminChallenge.updateMany({ where: {
    id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() },
    attempts: { lt: challenge.maxAttempts }, lastSentAt: { lte: cutoff },
  }, data: { attempts: { increment: 1 }, lastSentAt: new Date() } });
  if (reserved.count !== 1) throw invalidChallenge();
  await supabasePublic.requestLoginCode(challenge.email);
  await writeAudit({ actorId: challenge.userId, ipAddress: context.ipAddress }, "ADMIN_OTP_RESENT", challenge.userId);
  return { status: "otp_required" as const, expiresAt: challenge.expiresAt.toISOString(), resendAfter: RESEND_MS / 1000 };
}

export async function cancelAdminOtp(token: unknown, context: ChallengeContext) {
  // Cancellation is idempotent, including after expiry or attempt exhaustion.
  const challenge = await prismaPg.adminChallenge.findUnique({ where: { challengeHash: hashChallenge(token) } });
  if (!challenge || challenge.client !== context.client || challenge.origin !== context.origin) throw invalidChallenge();
  const result = await prismaPg.adminChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (result.count) await writeAudit({ actorId: challenge.userId, ipAddress: context.ipAddress }, "ADMIN_OTP_CANCELLED", challenge.userId);
}
