import "./env.js";

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.AUTH_JWT_SECRET;
  if (
    !secret ||
    !/^[A-Za-z0-9_-]{43,}$/.test(secret) ||
    new Set(secret).size < 16
  ) {
    throw new Error(
      "AUTH_JWT_SECRET must be a randomly generated base64url secret of at least 32 bytes",
    );
  }
  const issuer = env.AUTH_JWT_ISSUER;
  const audience = env.AUTH_JWT_AUDIENCE;
  if (!issuer || !audience || issuer.length > 200 || audience.length > 200) {
    throw new Error(
      "AUTH_JWT_ISSUER and AUTH_JWT_AUDIENCE are required (maximum 200 characters)",
    );
  }
  const origins = (env.AUTH_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== "https:") {
      throw new Error(
        "AUTH_ALLOWED_ORIGINS must contain exact HTTPS origins without trailing slashes",
      );
    }
  }
  return { key: new TextEncoder().encode(secret), issuer, audience, origins };
}

export const authConfig = loadAuthConfig();
