import type { Prisma, Role } from "../generated/postgres-client/index.js";
import { authProvider } from "./auth-provider.js";
import { asyncRoute, HttpError } from "./http.js";
import { prismaPg } from "./prisma-pg.js";

export interface AdminIdentity {
  id: string;
  role: Role;
  authVersion?: number;
}
export const verificationRequired = () => new HttpError(
  403, "ADMIN_VERIFICATION_REQUIRED", "Complete administrator verification to continue.",
);

export async function assertAdminVerification(
  user: AdminIdentity,
  sessionId: string,
  client: Pick<Prisma.TransactionClient, "adminSessionVerification"> = prismaPg,
) {
  // LEAD_DEV is intentionally password-only; permission guards limit it to reads.
  if (user.role !== "ADMIN") return;
  if (authProvider() !== "supabase") throw verificationRequired();
  const proof = await client.adminSessionVerification.findUnique({ where: { supabaseSessionId: sessionId } });
  const now = new Date();
  if (!proof || proof.userId !== user.id || proof.expiresAt <= now || proof.verifiedAt > now ||
      proof.authVersion !== (user.authVersion ?? 0)) throw verificationRequired();
}

/** Mounted for the entire admin router, including unknown paths and mutations. */
export const requireAdminVerification = asyncRoute(async (_req, res, next) => {
  const auth: { user: AdminIdentity; sessionId: string } | undefined = res.locals.auth;
  if (!auth) throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
  await assertAdminVerification(auth.user, auth.sessionId);
  next();
});

/** PostgreSQL only: provider network calls must remain outside this transaction. */
export async function securityTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await prismaPg.$transaction(operation, { isolationLevel: "Serializable" }); }
    catch (error: unknown) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2034")) throw error;
      if (attempt === 2) throw new HttpError(409, "ADMIN_CONFLICT", "Account security changed concurrently. Please retry.");
    }
  }
  throw new HttpError(409, "ADMIN_CONFLICT", "Account security changed concurrently. Please retry.");
}

export async function invalidateAdminCredentials(tx: Prisma.TransactionClient, userId: string) {
  await tx.adminChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
  await tx.adminSessionVerification.deleteMany({ where: { userId } });
}
