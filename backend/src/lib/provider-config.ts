export class ProviderConfigurationError extends Error {}

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

export function validateProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  geminiApiKey(env);
  const plantnet = env.PLANTNET_API_KEY?.trim();
  if (!plantnet || /\s/.test(plantnet)) {
    throw new ProviderConfigurationError(
      "PLANTNET_API_KEY is required and must not contain whitespace.",
    );
  }
  // Perenual is deliberately optional: scans can proceed without reference specs.
}
