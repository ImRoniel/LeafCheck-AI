import type { ErrorRequestHandler, RequestHandler } from "express";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const asyncRoute =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
export function bodyObject(
  value: unknown,
  keys: string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new HttpError(400, "INVALID_INPUT", "Invalid request fields.");
  }
  return value as Record<string, unknown>;
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code });
  } else if (error?.type === "entity.too.large") {
    res
      .status(413)
      .json({ error: "Request body too large.", code: "BODY_TOO_LARGE" });
  } else if (error?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON.", code: "INVALID_JSON" });
  } else {
    // Do not log errors containing request bodies, credentials or Prisma arguments.
    res
      .status(500)
      .json({ error: "Internal server error.", code: "INTERNAL_ERROR" });
  }
};
