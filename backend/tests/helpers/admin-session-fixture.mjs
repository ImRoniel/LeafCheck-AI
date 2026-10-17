import { jwtVerify } from "jose";

/** Serializer/proxy suites use signed fixture tokens; auth flow tests use the real provider verifier. */
export function adminSessionFixture(lookup) {
  async function authenticatedProviderSession(token) {
    let claims;
    try {
      claims = (await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_JWT_SECRET), {
        issuer: process.env.AUTH_JWT_ISSUER, audience: process.env.AUTH_JWT_AUDIENCE, maxTokenAge: "15m", typ: "JWT",
      })).payload;
    } catch {
      const { HttpError } = await import("../../src/lib/http.ts");
      throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
    }
    const session = await lookup(claims.sid);
    if (!session || session.userId !== claims.sub || !session.user?.isActive || session.revokedAt || session.expiresAt <= new Date()) {
      const { HttpError } = await import("../../src/lib/http.ts");
      throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
    }
    return { user: session.user, sessionId: session.id, providerUserId: session.user.id };
  }
  return { authenticatedProviderSession,
    providerSession: async () => { throw new Error("Provider issuance is not part of this fixture."); },
    assertProviderSessionCurrent: () => {},
    revokeProviderSession: async () => { throw new Error("Provider issuance is not part of this fixture."); },
  };
}
