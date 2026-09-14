import { TelemetryPayload } from "./sensor.js";

export type { TelemetryPayload };

export interface AIDiagnosisRequest {
  imageBase64?: string;
  telemetry?: TelemetryPayload;
  plantId?: string;
  notes?: string;
}

export interface AIDiagnosisResponse {
  success: boolean;
  healthStatus: "healthy" | "warning" | "critical" | "unknown";
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
