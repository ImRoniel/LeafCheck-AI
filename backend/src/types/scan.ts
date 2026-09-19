// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Scan Pipeline Types
// ─────────────────────────────────────────────────────────────────────────────

/** Request body for POST /api/scan */
export interface ScanRequest {
  imageBase64: string;
  plantId: string;
  deviceId?: string;
}

/** Top-level response from POST /api/scan */
export interface ScanResponse {
  success: boolean;
  identification: {
    speciesName: string;
    commonName: string | null;
    confidence: number;
  };
  diagnostic: {
    id: string;
    healthStatus: string;
    rawAnalysisText: string;
    telemetryFreshness: string;
  };
  telemetry: {
    temperature: number;
    humidity: number;
    soilMoisture: number;
    lightLevel: number | null;
    timestamp: string;
  } | null;
  error?: string;
}

/** Return type from the Pl@ntNet identification client */
export interface PlantIdentificationResult {
  speciesName: string;
  commonName: string | null;
  confidence: number;
  rawResponse: unknown;
}

/** Normalized plant spec data for PostgreSQL PlantSpecCache insertion */
export interface PlantSpecData {
  speciesName: string;
  commonName: string | null;
  idealLuxMin: number | null;
  idealLuxMax: number | null;
  idealTempMinC: number | null;
  idealTempMaxC: number | null;
  idealHumidityMin: number | null;
  idealHumidityMax: number | null;
  idealPhMin: number | null;
  idealPhMax: number | null;
  wateringFrequency: string | null;
  sunlight: string | null;
  rawJson: unknown;
}
