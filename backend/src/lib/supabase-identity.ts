import { randomBytes } from "node:crypto";
import { prismaPg } from "./prisma-pg.js";
import { hashPassword } from "./password.js";
import { HttpError } from "./http.js";
import type { ProviderUser } from "./supabase-client.js";

const conflict = () => new HttpError(409, "IDENTITY_NOT_LINKED", "This account needs an explicit migration before email authentication can be used.");

/** Never link by email, replace an application ID, or copy a provider role. */
export async function applicationUser(identity: ProviderUser, provision = false) {
  if (!identity.emailConfirmedAt)
    throw new HttpError(401, "EMAIL_NOT_VERIFIED", "Verify your email before signing in.");
  const mapped = await prismaPg.user.findUnique({ where: { supabaseUserId: identity.id } });
  if (mapped) {
    if (!mapped.isActive || mapped.email !== identity.email)
      throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session.");
    return mapped;
  }
  if (!provision || await prismaPg.user.findUnique({ where: { email: identity.email } }))
    throw conflict();
  // The required legacy column stays intact. Only NEW provider accounts receive
  // a random, unknowable legacy password; existing hashes are never rewritten.
  const password = await hashPassword(randomBytes(48).toString("base64url"));
  try {
    return await prismaPg.user.create({ data: {
      email: identity.email, name: identity.name, password, role: "USER",
      supabaseUserId: identity.id, emailVerifiedAt: identity.emailConfirmedAt,
    } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const winner = await prismaPg.user.findUnique({ where: { supabaseUserId: identity.id } });
      if (winner?.isActive && winner.email === identity.email) return winner;
      throw conflict();
    }
    throw error;
  }
}

export async function mappedEmail(email: string) {
  const user = await prismaPg.user.findUnique({ where: { email } });
  return user?.isActive && user.supabaseUserId ? user : null;
}
