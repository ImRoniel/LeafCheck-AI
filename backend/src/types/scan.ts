// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Scan Pipeline Types
// ─────────────────────────────────────────────────────────────────────────────

/** Request body for POST /api/scan (scan-first: no plantId required) */
export interface ScanRequest {
  imageBase64?: string;
  reusePreviousImage?: boolean;
  plantId?: string;
  deviceId?: string;
  location?: string;
}

/** An application-validated care task derived from Gemini report actions. */
export interface CareTaskOutput {
  title: string;
  taskType: string;
  description: string;
  urgency: "routine" | "immediate" | "urgent";
  dueDate: string;
}

/** Notification scheduling from Gemini AI */
export interface NotificationOutput {
  notifyAt: string;
  reason: string;
}

export type SubjectKind = "living_plant" | "artificial_plant" | "non_plant";

/** Structured JSON output expected from Gemini */
export interface GeminiReportOutput {
  subjectKind: SubjectKind;
  healthStatus: "healthy" | "warning" | "critical" | "unknown";
  diagnosticReport: string;
  notification: NotificationOutput | null;
}

/** Validated report with application-derived tasks, not a provider task array. */
export interface GeminiStructuredOutput extends GeminiReportOutput {
  careTasks: CareTaskOutput[];
}

/** Top-level response from POST /api/scan */
export interface ScanResponse {
  success: boolean;
  subjectKind: SubjectKind;
  photoSaveFailed?: boolean;
  diagnosisError?: boolean;
  diagnosisMessage?: string;
  diagnosisCode?: string;
  telemetrySnapshot?: import("../lib/diagnosis-telemetry.js").DiagnosisTelemetrySnapshot | null;
  plant: {
    id: string;
    name: string;
    species: string;
    deviceId: string | null;
  } | null;
  identification: {
    speciesName: string;
    commonName: string | null;
    confidence: number;
  } | null;
  diagnostic: {
    id: string;
    healthStatus: string;
    rawAnalysisText: string | null;
    telemetryFreshness: string;
    createdAt?: string;
  };
  telemetry: {
    temperature: number;
    humidity: number;
    soilMoisture: number | null;
    soilMoistureRaw: number | null;
    lightLevel: number | null;
    timestamp: string;
  } | null;
  careTasks: CareTaskOutput[];
  notification: NotificationOutput | null;
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
