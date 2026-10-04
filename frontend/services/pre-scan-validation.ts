import { validationResult } from "./pre-scan-coordinator";
import type { PreScanResult } from "../types/pre-scan-validation";

/** Web/unsupported platforms never import native JSI packages or bypass required checks. */
export async function validatePreScan(_uri: string, signal?: AbortSignal): Promise<PreScanResult> {
  return signal?.aborted ? validationResult("cancelled") : {
    ...validationResult("validation_unavailable"),
    guidance: "Plant photo checks require the Android or iOS development build. Please scan your plant there.",
  };
}
