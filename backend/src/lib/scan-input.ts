import { HttpError } from "./http.js";

// Base64 expansion stays below the gateway's 10 MiB JSON limit.
export const MAX_SCAN_IMAGE_BYTES = 7 * 1024 * 1024;

export function validateScanImage(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length) {
    throw new HttpError(400, "INVALID_IMAGE", "A base64-encoded JPEG image is required.");
  }
  if (value.length > Math.ceil(MAX_SCAN_IMAGE_BYTES / 3) * 4) {
    throw new HttpError(413, "IMAGE_TOO_LARGE", "The JPEG image must be at most 7 MiB.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > MAX_SCAN_IMAGE_BYTES) {
    throw new HttpError(413, "IMAGE_TOO_LARGE", "The JPEG image must be at most 7 MiB.");
  }
  if (
    bytes.toString("base64") !== value ||
    bytes.length < 4 ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
    bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new HttpError(400, "INVALID_IMAGE", "Provide a valid base64-encoded JPEG image.");
  }
}
