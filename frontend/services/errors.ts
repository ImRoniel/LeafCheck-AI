export type ApiErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "cancelled"
  | "validation"
  | "application"
  | "busy";
export const CONNECTION_ERROR_MESSAGE =
  "Unable to connect to the server. Please check your internet connection and try again.";

// Replace the entire diagnostic rather than leaving fragments of internal setup advice.
export function sanitizeErrorMessage(message: string): string {
  const connectionDiagnostic =
    /EXPO_PUBLIC_API_URL|\bLAN\s+IP\b|\blocalhost\b|\b10\.0\.2\.2\b|\b127\.0\.0\.1\b|network\s*(?:request\s*)?(?:error|failed|failure)|failed to fetch|fetch failed|load failed|networkerror|request timed out|\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT)\b|(?:unable|failed|cannot|could not) to (?:connect|reach)|connection (?:failed|refused|reset|timed out)/i;
  return connectionDiagnostic.test(message)
    ? CONNECTION_ERROR_MESSAGE
    : message;
}

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(
      kind === "network" || kind === "timeout"
        ? CONNECTION_ERROR_MESSAGE
        : sanitizeErrorMessage(message),
    );
    this.name = "ApiError";
  }
}
export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(
        "network",
        error instanceof Error ? error.message : "Request failed",
        undefined,
        error,
      );
}
