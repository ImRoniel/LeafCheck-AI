import { HttpError } from "./http.js";
import { prismaPg } from "./prisma-pg.js";
import { applicationUser, mappedEmail } from "./supabase-identity.js";
import { assertProviderSessionCurrent, authenticatedProviderSession, providerSession, revokeProviderSession } from "./supabase-session.js";
import { object, ProviderError, supabaseAdmin, supabasePublic, type EmailOtpType } from "./supabase-client.js";
import { assertAdminVerification, invalidateAdminCredentials, securityTransaction, verificationRequired } from "./admin-verification.js";

export type OtpPurpose = "registration" | "login";
export const invalidOtp = () => new HttpError(400, "INVALID_CODE", "Invalid or expired code. Request a new one.");
export const challenge = (email: string, purpose: OtpPurpose) => ({
  status: "verification_required" as const, email, purpose, resendAfter: 60,
});
async function verifyEmailCode(email: string, code: string, type: EmailOtpType) {
  try { return await supabasePublic.verify(email, code, type); }
  catch (error) {
    if (error instanceof ProviderError && error.status === 400)
      throw invalidOtp();
    throw error;
  }
}
export async function registerProvider(data: { email: string; password: string; name?: string | null }) {
  if (await prismaPg.user.findUnique({ where: { email: data.email } }))
    throw new HttpError(409, "EMAIL_CONFLICT", "An account with this email already exists.");
  const response = object(await supabasePublic.signup(data.email, data.password, data.name));
  if (typeof response.access_token === "string") {
    await supabaseAdmin.logout(response.access_token, "local");
    throw new HttpError(503, "CONFIRM_EMAIL_REQUIRED", "Email verification must be enabled before registration.");
  }
  return challenge(data.email, "registration");
}
async function complete(tokens: Awaited<ReturnType<typeof supabasePublic.refresh>>, provision = false) {
  try {
    const live = await providerSession(tokens.accessToken);
    const identity = provision ? await supabasePublic.user(tokens.accessToken) : live.identity;
    if (identity.id !== live.identity.id || identity.email !== live.identity.email)
      throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
    const user = await applicationUser(identity, provision);
    assertProviderSessionCurrent(user, live.createdAt);
    return { tokens, user, sessionId: live.sessionId };
  } catch (error) {
    await supabaseAdmin.logout(tokens.accessToken, "local").catch(() => {});
    throw error;
  }
}
export async function loginProvider(email: string, password: string) {
  if (!await mappedEmail(email))
    throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  try { return await complete(await supabasePublic.passwordLogin(email, password)); }
  catch (error) {
    if (error instanceof ProviderError && error.status === 400)
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    throw error;
  }
}
export async function refreshProvider(token: string) {
  if (!token || token.length > 4096) throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
  try {
    const result = await complete(await supabasePublic.refresh(token));
    try { await assertAdminVerification(result.user, result.sessionId); }
    catch (error) { await supabaseAdmin.logout(result.tokens.accessToken, "local").catch(() => {}); throw error; }
    return result.tokens;
  }
  catch (error) {
    if (error instanceof ProviderError && error.status === 400)
      throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
    throw error;
  }
}
export async function requestLoginOtp(email: string) {
  if (await mappedEmail(email)) await supabasePublic.requestLoginCode(email);
  return challenge(email, "login");
}
export async function resendOtp(email: string, type: EmailOtpType) {
  if (type === "magiclink") return requestLoginOtp(email);
  if (type === "recovery") return forgotPassword(email);
  // A legacy application account is never enrolled by resend.
  if (!await prismaPg.user.findUnique({ where: { email } })) await supabasePublic.resendRegistration(email);
  return challenge(email, "registration");
}
export async function verifyOtp(email: string, code: string, type: EmailOtpType) {
  if (type !== "signup" && !await mappedEmail(email)) throw invalidOtp();
  const result = await complete(await verifyEmailCode(email, code, type), type === "signup");
  if (result.user.role === "ADMIN" || result.user.role === "LEAD_DEV") {
    await supabaseAdmin.logout(result.tokens.accessToken, "local");
    throw verificationRequired();
  }
  return result;
}
export async function forgotPassword(email: string) {
  if (await mappedEmail(email)) await supabasePublic.recover(email);
  return { message: "If an eligible account exists, a recovery code has been sent.", resendAfter: 60 };
}
export async function resetPassword(email: string, code: string, password: string) {
  const expected = await mappedEmail(email);
  if (!expected) throw new HttpError(400, "INVALID_CODE", "The code is invalid or expired.");
  const tokens = await verifyEmailCode(email, code, "recovery");
  try {
    const session = await authenticatedProviderSession(tokens.accessToken);
    if (session.user.id !== expected.id) throw new HttpError(400, "INVALID_CODE", "The code is invalid or expired.");
    await supabasePublic.updatePassword(tokens.accessToken, password);
    await securityTransaction(async tx => {
      await tx.user.update({ where: { id: session.user.id }, data: {
        passwordChangedAt: new Date(), authVersion: { increment: 1 }, authInvalidBefore: new Date(),
      } });
      await invalidateAdminCredentials(tx, session.user.id);
    });
    // Never expose recovery credentials or leave a password-reset session alive.
    await revokeProviderSession(tokens.accessToken, "global");
  } catch (error) {
    await supabaseAdmin.logout(tokens.accessToken, "local").catch(() => {});
    throw error;
  }
}
