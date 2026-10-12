import { geminiError } from "./gemini.js";
import { HttpError } from "./http.js";

/** Preserve the full stack and provider status while removing credentials. */
export function logDiagnosisError(error: unknown, stage: string) {
  let stack = error instanceof Error ? error.stack ?? `${error.name}: ${error.message}` : "Non-Error diagnosis failure";
  for (const name of ["GEMINI_API_KEY", "PLANTNET_API_KEY", "PERENUAL_API_KEY"]) {
    const secret = process.env[name]?.trim();
    if (secret) stack = stack.split(secret).join("[redacted]");
  }
  stack = stack.replace(/([?&](?:api[-_]?key|key|token|access_token)=)[^\s&]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
  // Pass stack as a string argument so logging does not truncate/escape its frames.
  console.error("[Scan] Gemini diagnosis failed", { stage, status }, stack);
}

export function diagnosisFailure(error: unknown) {
  const mapped = error instanceof HttpError ? error : geminiError(error);
  return { code: mapped.code, message: mapped.code === "SCAN_AI_BUSY"
    ? "The AI service is busy. Please try again in a few minutes."
    : "Scan saved. AI diagnosis failed. Retry to generate the diagnosis." };
}
