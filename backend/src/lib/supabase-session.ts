import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { supabaseConfig } from "./auth-provider.js";
import { HttpError } from "./http.js";
import { authRead } from "./prisma-auth-read.js";
import { applicationUser } from "./supabase-identity.js";
import { ProviderError, supabaseAdmin, supabasePublic, type ProviderUser } from "./supabase-client.js";

const invalid = () => new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let keys: { issuer: string; resolver: ReturnType<typeof createRemoteJWKSet> } | undefined;

async function verifiedClaims(token: string): Promise<JWTPayload> {
  const config = supabaseConfig();
  let claims: JWTPayload;
  try {
    const { alg } = decodeProtectedHeader(token);
    if (alg === "HS256") {
      // Legacy Supabase signing keys are checked by Auth itself, never with our
      // unrelated legacy AUTH_JWT_SECRET. Decoding alone never authenticates.
      const identity = await supabasePublic.user(token);
      claims = decodeJwt(token);
      if (claims.sub !== identity.id) throw invalid();
    } else {
      if (alg !== "ES256" && alg !== "RS256") throw invalid();
      if (keys?.issuer !== config.issuer)
        keys = { issuer: config.issuer, resolver: createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`)) };
      claims = (await jwtVerify(token, keys.resolver, {
        algorithms: ["ES256", "RS256"], issuer: config.issuer, audience: "authenticated",
        requiredClaims: ["sub", "session_id", "exp", "iat"], maxTokenAge: "15m",
      })).payload;
    }
  } catch (error) {
    if (error instanceof HttpError && error.status >= 500) throw error;
    throw invalid();
  }
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== config.issuer || !audience.includes("authenticated") ||
      typeof claims.sub !== "string" || !uuid.test(claims.sub) ||
      typeof claims.session_id !== "string" || !uuid.test(claims.session_id) ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      typeof claims.iat !== "number" || claims.iat > now + 30 || claims.iat < now - 900)
    throw invalid();
  return claims;
}

export async function providerSession(token: string) {
  const claims = await verifiedClaims(token);
  const id = claims.session_id as string;
  const userId = claims.sub!;
  // No session cache: removal by logout invalidates even an unexpired JWT.
  const [session, identity] = await Promise.all([authRead.session(id), authRead.user(userId)]);
  const now = new Date();
  if (!session || session.userId !== userId || !session.createdAt ||
      session.createdAt.getTime() + 30 * 86400000 <= now.getTime() ||
      (session.notAfter && session.notAfter <= now) ||
      !identity?.email || !identity.emailConfirmedAt ||
      (identity.bannedUntil && identity.bannedUntil > now)) throw invalid();
  return {
    sessionId: id,
    identity: { id: userId, email: identity.email.toLowerCase(), emailConfirmedAt: identity.emailConfirmedAt, name: null } satisfies ProviderUser,
  };
}

export async function authenticatedProviderSession(token: string) {
  const session = await providerSession(token);
  return { user: await applicationUser(session.identity), sessionId: session.sessionId, providerUserId: session.identity.id };
}

export async function revokeProviderSession(token: string, scope: "local" | "global") {
  const claims = await verifiedClaims(token);
  const ids = scope === "local" ? [claims.session_id as string]
    : (await authRead.sessions(claims.sub!)).map(row => row.id);
  try { await supabaseAdmin.logout(token, scope); }
  catch (error) {
    // Password updates can already have deleted the recovery session. Accept
    // that outcome only if the database proves every targeted session is gone.
    if (!(error instanceof ProviderError)) throw error;
    if ((await Promise.all(ids.map(id => authRead.session(id)))).some(Boolean)) throw error;
  }
  if ((await Promise.all(ids.map(id => authRead.session(id)))).some(Boolean))
    throw new HttpError(503, "REVOCATION_PENDING", "Session revocation could not be confirmed. Please retry.");
}
