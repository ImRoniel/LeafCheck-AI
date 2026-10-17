import { HttpError } from "./http.js";
import { supabaseConfig } from "./auth-provider.js";

export interface ProviderUser {
  id: string;
  email: string;
  emailConfirmedAt: Date | null;
  name: string | null;
}
export interface ProviderTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
export type EmailOtpType = "signup" | "magiclink" | "recovery";
export class ProviderError extends HttpError {
  constructor(public readonly providerStatus: number) {
    const status = providerStatus;
    super(status === 429 ? 429 : status >= 500 ? 503 : 400,
      status === 429 ? "RATE_LIMITED" : "PROVIDER_REJECTED",
      status === 429 ? "Please wait before requesting another code." : status >= 500 ? "Email authentication is temporarily unavailable." : "The code or credentials are invalid or expired.");
  }
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function providerUser(value: unknown): ProviderUser {
  const data = object(value);
  if (typeof data.id !== "string" || typeof data.email !== "string")
    throw new HttpError(502, "INVALID_PROVIDER_RESPONSE", "Invalid authentication response.");
  const confirmed = typeof data.email_confirmed_at === "string" ? new Date(data.email_confirmed_at) : null;
  const name = object(data.user_metadata).name;
  return {
    id: data.id, email: data.email.toLowerCase(),
    emailConfirmedAt: confirmed && Number.isFinite(confirmed.getTime()) ? confirmed : null,
    name: typeof name === "string" && name.trim().length > 0 && name.length <= 100 ? name.trim() : null,
  };
}
export function providerTokens(value: unknown): ProviderTokens {
  const data = object(value);
  if (typeof data.access_token !== "string" || !data.access_token ||
      typeof data.refresh_token !== "string" || !data.refresh_token ||
      typeof data.expires_in !== "number" || data.expires_in <= 0)
    throw new HttpError(502, "INVALID_PROVIDER_RESPONSE", "Invalid authentication response.");
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

/** Stateless REST clients: no SDK session storage or automatic refresh in the BFF. */
async function request(path: string, method: string, body?: unknown, accessToken?: string, admin = false): Promise<unknown> {
  const config = supabaseConfig();
  let response: Response;
  try {
    response = await fetch(`${config.issuer}${path}`, {
      method, signal: AbortSignal.timeout(15000),
      headers: {
        apikey: admin ? config.secretKey : config.publishableKey,
        ...(accessToken || admin ? { Authorization: `Bearer ${accessToken ?? config.secretKey}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new HttpError(503, "PROVIDER_UNAVAILABLE", "Email authentication is temporarily unavailable.");
  }
  if (!response.ok) throw new ProviderError(response.status);
  if (response.status === 204) return undefined;
  try { return await response.json(); }
  catch { throw new HttpError(502, "INVALID_PROVIDER_RESPONSE", "Invalid authentication response."); }
}

export const supabasePublic = {
  signup: (email: string, password: string, name?: string | null) =>
    request("/signup", "POST", { email, password, data: { name: name ?? null } }),
  passwordLogin: (email: string, password: string) =>
    request("/token?grant_type=password", "POST", { email, password }).then(providerTokens),
  refresh: (refreshToken: string) =>
    request("/token?grant_type=refresh_token", "POST", { refresh_token: refreshToken }).then(providerTokens),
  requestLoginCode: (email: string) => request("/otp", "POST", { email, create_user: false }),
  resendRegistration: (email: string) => request("/resend", "POST", { email, type: "signup" }),
  recover: (email: string) => request("/recover", "POST", { email }),
  verify: (email: string, code: string, type: EmailOtpType) =>
    request("/verify", "POST", { email, token: code, type }).then(providerTokens),
  user: (token: string) => request("/user", "GET", undefined, token).then(providerUser),
  updatePassword: (token: string, password: string) => request("/user", "PUT", { password }, token),
};
export const supabaseAdmin = {
  createUser: (email: string, password: string, name: string | null) =>
    request("/admin/users", "POST", { email, password, email_confirm: true, user_metadata: { name } }, undefined, true).then(providerUser),
  deleteUser: (id: string) => request(`/admin/users/${encodeURIComponent(id)}`, "DELETE", undefined, undefined, true),
  // Supabase authenticates logout with the user's JWT; the secret key stays server-side.
  logout: (token: string, scope: "local" | "global") =>
    request(`/logout?scope=${scope}`, "POST", undefined, token, true),
};
