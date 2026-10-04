export type PreScanReason =
  | "ok" | "blur" | "underexposed" | "overexposed"
  | "screen" | "printed_photo" | "invalid_image"
  | "validation_unavailable" | "validation_timeout" | "cancelled";

export interface PreScanResult {
  valid: boolean;
  reason: PreScanReason;
  guidance: string;
}

export interface PreScanAdapters {
  analyzeQuality(uri: string): Promise<unknown>;
  detectReproduction(uri: string): Promise<unknown>;
}

/** Contract for the separately supplied on-device reproduction classifier. */
export interface ReproductionScores {
  real: number;
  screen: number;
  printed_photo: number;
}
