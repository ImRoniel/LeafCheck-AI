import "./env.js";
import {
    ProviderConfigurationError,
    validateProviderConfig,
} from "./provider-config.js";

try {
  validateProviderConfig();
} catch (error) {
  // No credential values, provider URLs, or raw SDK errors in startup logs.
  console.error(
    "[Startup] Provider configuration error:",
    error instanceof ProviderConfigurationError
      ? error.message
      : "Unable to validate provider configuration.",
  );
  process.exit(1);
}
