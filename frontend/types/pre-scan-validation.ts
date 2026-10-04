export type PreScanReason = "ok" | "image_too_small" | "low_resolution" | "invalid_image" | "cancelled";

export interface PreScanResult {
  valid: boolean;
  reason: PreScanReason;
  guidance: string;
}

/** Metadata and JPEG base64 already returned by Expo Camera; no extra file-system module. */
export interface CapturedImageMetadata {
  width: number;
  height: number;
  base64?: string;
}
