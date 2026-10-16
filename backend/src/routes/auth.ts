import { Router, type Request, type Response } from "express";
import { authConfig } from "../lib/auth-config.js";
import {
  createSession,
  hashPassword,
  legacyUserSelect,
  requireAuth,
  rotateSession,
  safeUser,
  SESSION_MS,
  verifyPassword,
} from "../lib/auth.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { authProvider, requireSupabase } from "../lib/auth-provider.js";
import { forgotPassword, loginProvider, refreshProvider, registerProvider, requestLoginOtp, resendOtp, resetPassword, verifyOtp, type OtpPurpose } from "../lib/supabase-auth.js";
import { revokeProviderSession } from "../lib/supabase-session.js";

export const authRouter = Router();
const cookieName = "__Host-leafcheck-refresh";
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
};

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
    if (authProvider() === "supabase" && res.locals.client !== "native")
      throw new HttpError(400, "NATIVE_REQUIRED", "Email authentication requires the mobile app.");
    next();
  }),
);
function credentials(body: unknown, register: boolean) {
  const data = bodyObject(
    body,
    register ? ["email", "password", "name"] : ["email", "password"],
  );
  if (
    typeof data.email !== "string" ||
    data.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim()) ||
    typeof data.password !== "string" ||
    [...data.password].length < 8 ||
    [...data.password].length > 128
  ) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Valid email and a password of 8–128 characters are required.",
    );
  }
  return {
    email: data.email.trim().toLowerCase(),
    password: data.password,
    ...(register ? { name: validateName(data.name) } : {}),
  };
}
export function validateName(name: unknown): string | null {
  if (name === undefined || name === null) return null;
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 100) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Name must contain 1–100 characters.",
    );
  }
  return name.trim();
}
function sendTokens(
  res: Response,
  tokens: Awaited<ReturnType<typeof createSession>>,
  status = 200,
  user?: unknown,
) {
  if (res.locals.client === "browser") {
    res.cookie(cookieName, tokens.refreshToken, {
      ...cookieOptions,
      maxAge: SESSION_MS,
    });
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
    sendTokens(res, authProvider() === "supabase"
      ? await refreshProvider(token) : await rotateSession(token, res.locals.client));
  }),
);
for (const path of ["/logout", "/logout-all"]) {
  authRouter.post(
    path,
    requireAuth,
    asyncRoute(async (req, res) => {
      bodyObject(req.body ?? {}, []);
      if (authProvider() === "supabase") {
        await revokeProviderSession(req.get("authorization")!.slice(7), path === "/logout" ? "local" : "global");
        res.status(204).end();
        return;
      }
      await prismaPg.authSession.updateMany({
        where:
          path === "/logout"
            ? { id: res.locals.auth.sessionId }
            : { userId: res.locals.auth.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      res.clearCookie(cookieName, cookieOptions);
      res.status(204).end();
    }),
  );
}

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
for (const path of ["/forgot-password", "/reset-password", "/otp/request", "/otp/verify", "/otp/resend"]) {
  authRouter.post(path, asyncRoute(async (req, res) => {
    requireSupabase();
    if (res.locals.client !== "native") throw new HttpError(400, "NATIVE_REQUIRED", "Use the mobile app.");
    const allowed = path === "/reset-password" ? ["email", "code", "newPassword"]
      : path === "/otp/verify" ? ["email", "code", "purpose"]
      : path === "/otp/resend" ? ["email", "purpose"] : ["email"];
    const data = bodyObject(req.body, allowed);
    const address = email(data.email);
    if (path === "/forgot-password") { res.status(202).json(await forgotPassword(address)); return; }
    if (path === "/otp/request") { res.status(202).json(await requestLoginOtp(address)); return; }
    if (path === "/otp/resend") { res.status(202).json(await resendOtp(address, purpose(data.purpose))); return; }
    const digits = code(data.code);
    if (path === "/otp/verify") {
      const result = await verifyOtp(address, digits, purpose(data.purpose));
      sendTokens(res, result.tokens, 200, safeUser(result.user));
      return;
    }
    if (typeof data.newPassword !== "string" || [...data.newPassword].length < 8 || [...data.newPassword].length > 128)
      throw new HttpError(400, "INVALID_INPUT", "Password must contain 8–128 characters.");
    await resetPassword(address, digits, data.newPassword);
    res.status(204).end();
  }));
}
