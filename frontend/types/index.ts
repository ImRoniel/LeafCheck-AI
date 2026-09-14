// Canonical type barrel for the frontend package
export type {
  SoilMoisture,
  PHLevel,
  PARLight,
  EnvironmentalReadings,
  TelemetryPayload,
} from "./sensor";

export type {
  HealthStatus,
  PathogenDiagnosis,
  CareRecommendation,
  Plant,
} from "./plant";

export type { AIDiagnosisRequest, AIDiagnosisResponse } from "./ai";
