import { Router, type Request, type Response } from "express";
import { authConfig } from "../lib/auth-config.js";
import {
  createSession,
  hashPassword,
  legacyUserSelect,
  requireAuth,
  rotateSession,
  safeUser,
  verifyPassword,
} from "../lib/auth.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { authProvider, requireSupabase } from "../lib/auth-provider.js";
import { forgotPassword, invalidOtp, loginProvider, refreshProvider, registerProvider, requestLoginOtp, resendOtp, resetPassword, verifyOtp, type OtpPurpose } from "../lib/supabase-auth.js";
import type { EmailOtpType } from "../lib/supabase-client.js";
import { revokeProviderSession } from "../lib/supabase-session.js";
import { beginAdminChallenge, verifyAdminOtp, resendAdminOtp, cancelAdminOtp, type ChallengeContext } from "../lib/admin-mfa.js";
import { verificationRequired } from "../lib/admin-verification.js";
import { credentials } from "../lib/auth-input.js";
import { changePassword } from "../lib/change-password.js";
export { validateName } from "../lib/auth-input.js";

export const authRouter = Router();
const cookieName = "__Host-leafcheck-refresh";
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};
const browserSupabasePaths = new Set(["/login", "/refresh", "/logout", "/logout-all", "/verify-admin-otp", "/admin-otp/resend", "/admin-otp/cancel", "/change-password", "/forgot-password", "/reset-password"]);

function challengeContext(req: Request, res: Response): ChallengeContext {
  return { client: res.locals.client, origin: req.get("origin") ?? null, ipAddress: req.ip };
}

// Native clients explicitly opt into JSON; any browser signal forces cookie mode.
export function clientMode(req: Request): "browser" | "native" {
  const origin = req.get("origin");
  const browser =
    !!origin || !!req.get("sec-fetch-site") || !!req.get("cookie");
  if (browser || req.get("x-auth-client") !== "native") {
    if (
      !origin ||
      !authConfig.origins.includes(origin) ||
      req.get("x-csrf-protection") !== "1"
    ) {
      throw new HttpError(
        403,
        "ORIGIN_REJECTED",
        "Origin or CSRF protection rejected.",
      );
    }
    return "browser";
  }
  return "native";
}
authRouter.use(
  asyncRoute((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.locals.client = clientMode(req);
    if (
      authProvider() === "supabase" && res.locals.client !== "native" &&
      (req.method !== "POST" || !browserSupabasePaths.has(req.path))
    )
      throw new HttpError(400, "NATIVE_REQUIRED", "Email authentication requires the mobile app.");
    next();
  }),
);
function sendTokens(
  res: Response,
  tokens: Awaited<ReturnType<typeof createSession>>,
  status = 200,
  user?: unknown,
) {
  if (res.locals.client === "browser") {
    // Browser-session cookie: issuance and rotation must not set an expiry.
    // Server-side session expiry and the administrator's OTP proof still apply.
    res.cookie(cookieName, tokens.refreshToken, cookieOptions);
    res.status(status).json({
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      ...(user ? { user } : {}),
    });
  } else res.status(status).json({ ...tokens, ...(user ? { user } : {}) });
}
authRouter.post(
  "/register",
  asyncRoute(async (req, res) => {
    const data = credentials(req.body, true);
    if (authProvider() === "supabase") {
      res.status(202).json(await registerProvider(data));
      return;
    }
    const password = await hashPassword(data.password);
    let user;
    try {
      user = await prismaPg.user.create({
        data: { ...data, password, role: "USER" },
        select: legacyUserSelect,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new HttpError(
          409,
          "EMAIL_CONFLICT",
          "An account with this email already exists.",
        );
      }
      throw error;
    }
    sendTokens(
      res,
      await createSession(user.id, res.locals.client),
      201,
      safeUser(user),
    );
  }),
);
authRouter.post(
  "/login",
  asyncRoute(async (req, res) => {
    const data = credentials(req.body, false);
    if (authProvider() === "supabase") {
      const result = await loginProvider(data.email, data.password);
      if (result.user.role === "ADMIN" || result.user.role === "LEAD_DEV") {
        res.clearCookie(cookieName, cookieOptions);
        await revokeProviderSession(result.tokens.accessToken, "local");
        res.status(202).json(await beginAdminChallenge(result.user, challengeContext(req, res)));
        return;
      }
      sendTokens(res, result.tokens, 200, safeUser(result.user));
      return;
    }
    const user = await prismaPg.user.findUnique({
      where: { email: data.email },
      select: legacyUserSelect,
    });
    const valid = await verifyPassword(data.password, user?.password);
    if (!valid || !user?.isActive)
      throw new HttpError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password.",
      );
    // Legacy credentials cannot satisfy the mandatory provider OTP policy.
    if (user.role === "ADMIN") throw verificationRequired();
    sendTokens(
      res,
      await createSession(user.id, res.locals.client),
      200,
      safeUser(user),
    );
  }),
);
authRouter.post(
  "/refresh",
  asyncRoute(async (req, res) => {
    const browser = res.locals.client === "browser";
    const data = bodyObject(req.body ?? {}, browser ? [] : ["refreshToken"]);
    const cookies = (req.get("cookie") ?? "")
      .split(";")
      .map((value) => value.trim())
      .filter((value) => value.startsWith(`${cookieName}=`));
    const token =
      browser && cookies.length === 1
        ? cookies[0].slice(cookieName.length + 1)
        : data.refreshToken;
    if (typeof token !== "string")
      throw new HttpError(
        401,
        "INVALID_SESSION",
        "Invalid or expired session.",
      );
    try {
      sendTokens(res, authProvider() === "supabase"
        ? await refreshProvider(token) : await rotateSession(token, res.locals.client));
    } catch (error) {
      if (browser && error instanceof HttpError && (error.status === 401 || error.code === "ADMIN_VERIFICATION_REQUIRED"))
        res.clearCookie(cookieName, cookieOptions);
      throw error;
    }
  }),
);
authRouter.post("/change-password", requireAuth, asyncRoute(async (req, res) => {
  requireSupabase();
  const data = bodyObject(req.body, ["currentPassword", "newPassword"]);
  const fieldErrors: Record<string, string> = {};
  if (typeof data.currentPassword !== "string" || !data.currentPassword || [...data.currentPassword].length > 128)
    fieldErrors.currentPassword = "Enter your current password (up to 128 characters).";
  if (typeof data.newPassword !== "string" || [...data.newPassword].length < 8 || [...data.newPassword].length > 128)
    fieldErrors.newPassword = "Password must contain 8–128 characters.";
  if (typeof data.newPassword === "string" && data.newPassword === data.currentPassword)
    fieldErrors.newPassword = "The new password must differ from your current password.";
  if (Object.keys(fieldErrors).length || typeof data.currentPassword !== "string" || typeof data.newPassword !== "string")
    throw new HttpError(400, "INVALID_INPUT", "Check the password fields and try again.", fieldErrors);
  const user = await changePassword(res.locals.auth.user, res.locals.auth.sessionId,
    req.get("authorization")!.slice(7), data.currentPassword, data.newPassword, req.ip);
  res.json(safeUser(user));
}));

for (const path of ["/logout", "/logout-all"]) {
  authRouter.post(
    path,
    asyncRoute((_req, res, next) => {
      // Origin/CSRF validation has run; clear the cookie even if authentication fails.
      res.clearCookie(cookieName, cookieOptions);
      next();
    }),
    requireAuth,
    asyncRoute(async (req, res) => {
      bodyObject(req.body ?? {}, []);
      if (authProvider() === "supabase") {
        const userId: string = res.locals.auth.user.id;
        await prismaPg.adminSessionVerification.deleteMany({ where: path === "/logout" ? {
          userId, supabaseSessionId: res.locals.auth.sessionId,
        } : { userId } });
        await revokeProviderSession(req.get("authorization")!.slice(7), path === "/logout" ? "local" : "global");
      } else {
        await prismaPg.authSession.updateMany({
          where:
            path === "/logout"
              ? { id: res.locals.auth.sessionId }
              : { userId: res.locals.auth.user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      res.status(204).end();
    }),
  );
}

authRouter.post("/verify-admin-otp", asyncRoute(async (req, res) => {
  requireSupabase();
  const data = bodyObject(req.body, ["challengeToken", "code"]);
  const result = await verifyAdminOtp(data.challengeToken, data.code, challengeContext(req, res));
  sendTokens(res, result.tokens, 200, safeUser(result.user));
}));
authRouter.post("/admin-otp/resend", asyncRoute(async (req, res) => {
  requireSupabase();
  const data = bodyObject(req.body, ["challengeToken"]);
  res.status(202).json(await resendAdminOtp(data.challengeToken, challengeContext(req, res)));
}));
authRouter.post("/admin-otp/cancel", asyncRoute(async (req, res) => {
  requireSupabase();
  const data = bodyObject(req.body, ["challengeToken"]);
  await cancelAdminOtp(data.challengeToken, challengeContext(req, res));
  res.status(204).end();
}));

authRouter.get("/capabilities", asyncRoute((_req, res) => {
  const enabled = authProvider() === "supabase";
  res.json({ provider: authProvider(), emailOtp: enabled, passwordRecovery: enabled });
}));

function email(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    throw new HttpError(400, "INVALID_INPUT", "Enter a valid email address.");
  return value.trim().toLowerCase();
}
function code(value: unknown): string {
  if (typeof value !== "string" || !/^\d{8}$/.test(value))
    throw new HttpError(400, "INVALID_INPUT", "Enter the eight-digit email code.");
  return value;
}
function purpose(value: unknown): OtpPurpose {
  if (value !== "registration" && value !== "login")
    throw new HttpError(400, "INVALID_INPUT", "Invalid verification purpose.");
  return value;
}
function verificationType(data: Record<string, unknown>): EmailOtpType {
  const previous = data.purpose === undefined ? undefined
    : purpose(data.purpose) === "registration" ? "signup" : "magiclink";
  // Older native releases send purpose; new releases send the exact provider type.
  const type = data.type ?? previous;
  if (type !== "signup" && type !== "magiclink" && type !== "recovery")
    throw new HttpError(400, "INVALID_INPUT", "A valid OTP type is required.");
  if (previous && previous !== type) throw invalidOtp();
  return type;
}
for (const path of ["/forgot-password", "/reset-password", "/otp/request", "/otp/verify", "/otp/resend"]) {
  authRouter.post(path, asyncRoute(async (req, res) => {
    requireSupabase();
    if (res.locals.client !== "native" && path !== "/forgot-password" && path !== "/reset-password")
      throw new HttpError(400, "NATIVE_REQUIRED", "Use the mobile app.");
    const allowed = path === "/reset-password" ? ["email", "code", "newPassword"]
      : path === "/otp/verify" ? ["email", "code", "type", "purpose"]
      : path === "/otp/resend" ? ["email", "type", "purpose"] : ["email"];
    const data = bodyObject(req.body, allowed);
    const address = email(data.email);
    if (path === "/forgot-password") { res.status(202).json(await forgotPassword(address)); return; }
    if (path === "/otp/request") { res.status(202).json(await requestLoginOtp(address)); return; }
    if (path === "/otp/resend") { res.status(202).json(await resendOtp(address, verificationType(data))); return; }
    const digits = code(data.code);
    if (path === "/otp/verify") {
      const result = await verifyOtp(address, digits, verificationType(data));
      sendTokens(res, result.tokens, 200, safeUser(result.user));
      return;
    }
    if (typeof data.newPassword !== "string" || [...data.newPassword].length < 8 || [...data.newPassword].length > 128)
      throw new HttpError(400, "INVALID_INPUT", "Password must contain 8–128 characters.");
    await resetPassword(address, digits, data.newPassword);
    if (res.locals.client === "browser") res.clearCookie(cookieName, cookieOptions);
    res.status(204).end();
  }));
}
