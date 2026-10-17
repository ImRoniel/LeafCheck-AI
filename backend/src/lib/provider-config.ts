export class ProviderConfigurationError extends Error {}

/** Shared by the request runtime and the configuration-only admin monitor. */
export function geminiModelName(env: NodeJS.ProcessEnv = process.env): string {
  return env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

export function geminiApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new ProviderConfigurationError("GEMINI_API_KEY is required.");
  }
  // Accept legacy and newer AI Studio key formats. AQ. suffix lengths can
  // vary; validate its prefix/characters without imposing the legacy length.
  // Format validation cannot determine whether Google will authorize a key.
  if (!/^(?:AIza[A-Za-z0-9_-]{35}|AQ\.[A-Za-z0-9_-]+)$/.test(key)) {
    throw new ProviderConfigurationError(
      "GEMINI_API_KEY must be a Google AI Studio API key starting with AIza or AQ. and containing a URL-safe suffix, not a bearer token or service-account credential.",
    );
  }
  return key;
}

/** Shared startup/runtime validation; diagnostics never contain credential values. */
export function supabaseProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  const missing = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]
    .filter(name => !env[name]?.trim());
  if (missing.length)
    throw new ProviderConfigurationError(`${missing.join(", ")} required when AUTH_PROVIDER=supabase.`);
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY!.trim();
  const secretKey = env.SUPABASE_SECRET_KEY!.trim();
  const invalidUrl = () => new ProviderConfigurationError("SUPABASE_URL must be an HTTPS project origin.");
  let url: URL;
  try { url = new URL(env.SUPABASE_URL!.trim()); }
  catch { throw invalidUrl(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw invalidUrl();
  return { url: url.origin, issuer: `${url.origin}/auth/v1`, publishableKey, secretKey };
}

export function validateProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  geminiApiKey(env);
  if (env.AUTH_PROVIDER === "supabase") supabaseProviderConfig(env);
  // Pl@ntNet and Perenual are optional. Gemini can identify and diagnose alone.
}
