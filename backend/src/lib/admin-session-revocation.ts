import { invalidateAdminCredentials, securityTransaction } from "./admin-verification.js";
import { authorizeOperation } from "./admin-device-operations.js";
import type { AdminActor } from "./admin-users.js";
import { writeAudit } from "./audit.js";
import { HttpError } from "./http.js";

/** Enforce the application cutoff without writing to provider-owned auth tables. */
export async function revokeUserSessions(id: string, reason: string, actor: AdminActor) {
  return securityTransaction(async tx => {
    await authorizeOperation(tx, actor, "sessions.revoke");
    const before = await tx.user.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "NOT_FOUND", "User not found.");
    const cutoff = new Date(Math.max(Date.now(), before.authInvalidBefore?.getTime() ?? 0));
    const user = await tx.user.update({ where: { id }, data: {
      authVersion: { increment: 1 }, authInvalidBefore: cutoff,
      updatedAt: new Date(Math.max(Date.now(), before.updatedAt.getTime() + 1)),
    }, select: { id: true, authVersion: true, authInvalidBefore: true } });
    const revoked = await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: cutoff } });
    await invalidateAdminCredentials(tx, id);
    await writeAudit(actor, "USER_SESSIONS_REVOKED", id, { reason,
      before: { authVersion: before.authVersion, authInvalidBefore: before.authInvalidBefore?.toISOString() ?? null },
      after: { authVersion: user.authVersion, authInvalidBefore: cutoff.toISOString() },
      revokedLegacySessions: revoked.count, providerSessionPolicy: "APPLICATION_CUTOFF",
    }, tx);
    return { ...user, revokedSessions: revoked.count };
  });
}
