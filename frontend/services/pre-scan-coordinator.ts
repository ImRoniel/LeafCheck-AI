import type { CapturedImageMetadata, PreScanReason, PreScanResult } from "../types/pre-scan-validation";

export const MIN_IMAGE_BYTES = 50 * 1024;
export const MIN_IMAGE_DIMENSION = 320;

const guidance: Record<PreScanReason, string> = {
  ok: "",
  image_too_small: "This photo may be too dark or blank. Fill the frame with well-lit leaves and try another photo.",
  low_resolution: "This photo is too small to analyze. Take a higher-resolution photo of the leaves.",
  invalid_image: "We couldn’t check this photo. Please take another photo.",
  cancelled: "Photo check cancelled. Please take another photo.",
};
export const validationResult = (reason: PreScanReason): PreScanResult => ({
  valid: reason === "ok", reason, guidance: guidance[reason],
});

/** JPEG file bytes from camera base64, excluding base64's encoding overhead. No pixel decoding. */
export function capturedImageBytes(base64: unknown): number | null {
  if (typeof base64 !== "string" || base64.length === 0 || base64.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return base64.length / 4 * 3 - padding;
}

/** Fast metadata heuristics only: file size cannot prove exposure, blur or plant authenticity. */
export function validateCapturedImage(image: CapturedImageMetadata, signal?: AbortSignal): PreScanResult {
  if (signal?.aborted) return validationResult("cancelled");
  if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || image.width <= 0 || image.height <= 0) return validationResult("invalid_image");
  const bytes = capturedImageBytes(image.base64);
  if (bytes === null || bytes <= 0) return validationResult("invalid_image");
  if (image.width < MIN_IMAGE_DIMENSION || image.height < MIN_IMAGE_DIMENSION)
    return validationResult("low_resolution");
  if (bytes < MIN_IMAGE_BYTES) return validationResult("image_too_small");
  return validationResult("ok");
}
