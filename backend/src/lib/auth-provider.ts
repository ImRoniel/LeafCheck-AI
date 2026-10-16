import "./env.js";
import { HttpError } from "./http.js";

export function authProvider(): "legacy" | "supabase" {
  const value = process.env.AUTH_PROVIDER ?? "legacy";
  if (value !== "legacy" && value !== "supabase")
    throw new Error("AUTH_PROVIDER must be legacy or supabase.");
  return value;
}

export function requireSupabase() {
  if (authProvider() !== "supabase")
    throw new HttpError(503, "AUTH_PROVIDER_UNAVAILABLE", "Email code authentication is not available yet.");
}

export function supabaseConfig() {
  requireSupabase();
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY)
    throw new Error("Supabase URL, publishable key and secret key are required.");
  const url = new URL(SUPABASE_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("SUPABASE_URL must be an HTTPS project origin.");
  return {
    url: url.origin,
    issuer: `${url.origin}/auth/v1`,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    secretKey: SUPABASE_SECRET_KEY,
  };
}
