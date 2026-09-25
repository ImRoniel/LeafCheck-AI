import { ApiError } from "./errors";

export function scanNeedsServiceRecovery(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const details = error.details;
  const code =
    details && typeof details === "object" && "code" in details
      ? details.code
      : undefined;
  return [
    "SCAN_AI_CONFIGURATION",
    "SCAN_AI_BUSY",
    "SCAN_AI_UNAVAILABLE",
    "PLANT_IDENTIFICATION_FAILED",
  ].includes(String(code));
}

// An allowlisted presentation layer: diagnostics stay in the error object,
// never in user-facing copy. Support both current codes and older providers.
export function scanErrorMessage(error: unknown): string {
  const apiError = error instanceof ApiError ? error : null;
  const details = apiError?.details;
  const code =
    details && typeof details === "object" && "code" in details
      ? details.code
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (
    code === "SCAN_AI_CONFIGURATION" ||
    /ACCESS_TOKEN_TYPE_UNSUPPORTED|API_KEY_INVALID/i.test(message)
  )
    return "Your photo isn’t the problem. Plant analysis needs a fix on our side. Please come back and try again later.";
  if (code === "SCAN_AI_BUSY")
    return "Plant analysis is handling a lot of requests. Please give it a little time and try again later.";
  if (code === "SCAN_AI_UNAVAILABLE")
    return "We couldn’t finish the health check for your plant. Please try again later; there’s no need to change your photo.";
  if (code === "PLANT_IDENTIFICATION_FAILED")
    return "We couldn’t reach our plant identification service. Please try again later.";
  if (apiError?.kind === "cancelled")
    return "Your scan was paused. Take another photo when you're ready.";
  if (apiError?.kind === "timeout")
    return "This is taking a little longer than usual. Check your connection and try again in a moment.";
  if (apiError?.kind === "network")
    return "We couldn't connect just now. Check your internet connection, then try again.";
  if (
    code === "NO_PLANT_DETECTED" ||
    /NO_PLANT_DETECTED|species not found|no match|could(?:n't| not) (?:detect|identify|recognize) (?:a |the )?plant|pl[@a]ntnet.*\b404\b/i.test(
      message,
    )
  )
    return "We couldn't quite recognize a plant in this photo. Try moving closer to the leaves in a well-lit area.";
  if (apiError?.status === 401 || apiError?.status === 403)
    return "Please sign in again so we can scan your plant and save its results.";
  if (apiError?.status === 429)
    return "Our plant scanner is a little busy. Give it a moment, then try again.";
  if (apiError?.status === 413 || /image is too large/i.test(message))
    return "This photo is a little too large to scan. Try taking another photo.";
  if (code === "PLANT_IDENTIFICATION_FAILED" || (apiError?.status ?? 0) >= 500)
    return "Our plant scanner isn't available right now. Please try again in a little while.";
  return "We couldn't finish this scan. Try another clear photo of the leaves. If it happens again, try a little later.";
}
