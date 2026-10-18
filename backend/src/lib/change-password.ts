import type { User } from "../generated/postgres-client/index.js";
import { assertAdminVerification, securityTransaction } from "./admin-verification.js";
import { writeAudit } from "./audit.js";
import { HttpError } from "./http.js";
import { loginProvider } from "./supabase-auth.js";
import { supabasePublic } from "./supabase-client.js";
import { revokeProviderSession } from "./supabase-session.js";

export async function changePassword(
  user: User, sessionId: string, accessToken: string,
  currentPassword: string, newPassword: string, ipAddress?: string,
) {
  await assertAdminVerification(user, sessionId);
  // Verify through the provider even when its optional current-password policy is off.
  let confirmation;
  try { confirmation = await loginProvider(user.email, currentPassword); }
  catch (error: unknown) {
    if (error instanceof HttpError && error.code === "INVALID_CREDENTIALS")
      throw new HttpError(400, "CURRENT_PASSWORD_INVALID", "Your current password is incorrect.", { currentPassword: "Your current password is incorrect." });
    throw error;
  }
  await revokeProviderSession(confirmation.tokens.accessToken, "local");
  if (confirmation.user.id !== user.id || confirmation.user.supabaseUserId !== user.supabaseUserId)
    throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");

  await supabasePublic.updatePassword(accessToken, newPassword, currentPassword);
  try {
    const changed = await securityTransaction(async tx => {
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current?.isActive || current.authVersion !== user.authVersion || current.supabaseUserId !== user.supabaseUserId)
        throw new HttpError(409, "ACCOUNT_CHANGED", "Account security changed. Please sign in again.");
      await assertAdminVerification(current, sessionId, tx);
      const passwordChangedAt = new Date();
      const updated = await tx.user.update({ where: { id: user.id }, data: { passwordChangedAt } });
      await tx.adminChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: passwordChangedAt } });
      await tx.adminSessionVerification.deleteMany({ where: { userId: user.id, supabaseSessionId: { not: sessionId } } });
      await writeAudit({ actorId: user.id, ipAddress }, "PASSWORD_CHANGED", user.id, {}, tx);
      return updated;
    });
    // Keep the current session and its original OTP deadline; revoke all others.
    await revokeProviderSession(accessToken, "others");
    return changed;
  } catch {
    throw new HttpError(503, "PASSWORD_CHANGE_INCOMPLETE", "Your password was changed, but session cleanup could not be confirmed. Please sign in with your new password.");
  }
}
