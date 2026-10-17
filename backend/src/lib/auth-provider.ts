import "./env.js";
import { HttpError } from "./http.js";
import { supabaseProviderConfig } from "./provider-config.js";

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
  return supabaseProviderConfig();
}
