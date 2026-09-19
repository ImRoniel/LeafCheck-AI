export type ApiErrorKind = "http" | "network" | "timeout" | "cancelled" | "validation" | "application" | "busy";
export class ApiError extends Error {
  constructor(public readonly kind: ApiErrorKind, message: string, public readonly status?: number, public readonly details?: unknown) {
    super(message); this.name = "ApiError";
  }
}
export function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("network", error instanceof Error ? error.message : "Request failed", undefined, error);
}
