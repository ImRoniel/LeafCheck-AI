import { validateCapturedImage } from "./pre-scan-coordinator";
import type { CapturedImageMetadata, PreScanResult } from "../types/pre-scan-validation";

/** Shared Expo Go/web validator; no native bindings or file reads. */
export async function validatePreScan(image: CapturedImageMetadata, signal?: AbortSignal): Promise<PreScanResult> {
  return validateCapturedImage(image, signal);
}
