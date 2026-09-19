// Canonical type barrel for the frontend package
export type {
  EnvironmentalReadings, LightLevel,
  SensorReading, SoilMoisture, TelemetryHistory, TelemetryPayload
} from "./sensor";

export type {
  CareRecommendation, HealthStatus,
  PathogenDiagnosis, Plant
} from "./plant";

export type { AIDiagnosisRequest, AIDiagnosisResponse } from "./ai";
export type { PlantHealthUpdate, ScanRequest, ScanResponse } from "./scan";

