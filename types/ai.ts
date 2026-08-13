import { PathogenDiagnosis, CareRecommendation } from './plant';
import { TelemetryPayload } from './sensor';

export interface AIDiagnosisRequest {
  plantId?: string;
  imageBase64?: string;
  imageUri?: string;
  telemetry?: TelemetryPayload;
  notes?: string;
}

export interface AIDiagnosisResponse {
  success: boolean;
  plantName?: string;
  healthStatus: 'healthy' | 'warning' | 'critical' | 'unknown';
  diagnoses: PathogenDiagnosis[];
  recommendations: CareRecommendation[];
  rawAnalysisText?: string;
  timestamp: string;
  error?: string;
}
