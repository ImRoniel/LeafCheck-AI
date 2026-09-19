import type { HealthStatus } from "./plant";
export interface ScanRequest { imageBase64: string; plantId: string; deviceId?: string }
export interface ScanResponse {
  success: true;
  identification: { speciesName: string; commonName: string | null; confidence: number };
  diagnostic: { id: string; healthStatus: HealthStatus; rawAnalysisText: string; telemetryFreshness: string };
  telemetry: { temperature: number; humidity: number; soilMoisture: number; lightLevel: number | null; timestamp: string } | null;
}
export interface PlantHealthUpdate { id: string; healthStatus: HealthStatus }
