import type { HealthStatus } from "./plant";
import type { TelemetryPayload } from "./sensor";

export type { HealthStatus, TelemetryPayload };

export interface AIDiagnosisRequest {
  imageBase64?: string;
  telemetry?: TelemetryPayload;
  plantId?: string;
  notes?: string;
}

export interface AIDiagnosisResponse {
  success: boolean;
  healthStatus: HealthStatus | "unknown";
  diagnoses: {
    diseaseName: string;
    confidence: number;
    severity: "low" | "moderate" | "high" | "severe";
    symptoms: string[];
    description: string;
    affectedAreaPercentage?: number;
  }[];
  recommendations: {
    action: string;
    urgency: "routine" | "immediate" | "urgent";
    details: string;
    wateringAdjustments?: string;
    lightAdjustments?: string;
  }[];
  rawAnalysisText?: string;
  timestamp: string;
  error?: string;
}
