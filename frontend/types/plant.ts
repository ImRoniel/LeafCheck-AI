export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

export interface PathogenDiagnosis {
  diseaseName: string;
  confidence: number; // 0 to 1
  severity: "low" | "moderate" | "high" | "severe";
  symptoms: string[];
  description: string;
  affectedAreaPercentage?: number;
}

export interface CareRecommendation {
  action: string;
  urgency: "routine" | "immediate" | "urgent";
  details: string;
  wateringAdjustments?: string;
  lightAdjustments?: string;
}

export interface Plant {
  id: string;
  deviceId?: string;
  simulated?: boolean;
  name: string;
  species: string;
  location?: string;
  minMoisture?: number;
  maxMoisture?: number;
  healthStatus: HealthStatus;
  lastScannedAt?: string;
  imageUrl?: string;
  diagnoses?: PathogenDiagnosis[];
  recommendations?: CareRecommendation[];
  createdAt: string;
  updatedAt: string;
}
