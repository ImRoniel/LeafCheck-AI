import { Router, type Request, type Response } from "express";
import { authConfig } from "../lib/auth-config.js";
import {
  createSession,
  hashPassword,
  requireAuth,
  rotateSession,
  safeUser,
  SESSION_MS,
  verifyPassword,
} from "../lib/auth.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { prismaPg } from "../lib/prisma-pg.js";

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
    const password = await hashPassword(data.password);
    let user;
    try {
      user = await prismaPg.user.create({
        data: { ...data, password, role: "USER" },
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
    const user = await prismaPg.user.findUnique({
      where: { email: data.email },
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
    sendTokens(res, await rotateSession(token, res.locals.client));
  }),
);
for (const path of ["/logout", "/logout-all"]) {
  authRouter.post(
    path,
    requireAuth,
    asyncRoute(async (req, res) => {
      bodyObject(req.body ?? {}, []);
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
