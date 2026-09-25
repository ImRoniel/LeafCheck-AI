import type { HealthStatus } from "./plant";

/** Request body: plantId is now optional for scan-first flow */
export interface ScanRequest {
  imageBase64: string;
  plantId?: string;
  deviceId?: string;
  location?: string;
}

export interface CareTaskOutput {
  title: string;
  taskType: string;
  description: string;
  urgency: "routine" | "immediate" | "urgent";
  dueDate: string;
}

export interface NotificationOutput {
  notifyAt: string;
  reason: string;
}

export interface ScanResponse {
  success: true;
  plant: { id: string; name: string; species: string };
  identification: {
    speciesName: string;
    commonName: string | null;
    confidence: number;
  };
  diagnostic: {
    id: string;
    healthStatus: HealthStatus;
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
  careTasks: CareTaskOutput[];
  notification: NotificationOutput | null;
}

export interface PlantHealthUpdate {
  id: string;
  healthStatus: HealthStatus;
}

/** Archive entry returned from GET /api/scan/archives */
export interface ArchiveEntry {
  id: string;
  plantId: string;
  userId: string | null;
  healthStatus: string;
  rawAnalysisText: string | null;
  speciesName: string | null;
  notificationTime: string | null;
  notificationReason: string | null;
  createdAt: string;
  plant: { id: string; name: string; species: string } | null;
}

/** Care task returned from GET /api/scan/tasks */
export interface CareTask {
  id: string;
  plantId: string;
  title: string;
  taskType: string;
  description: string | null;
  status: string;
  urgency: string;
  dueDate: string;
  completedAt: string | null;
  createdAt: string;
  plant: { id: string; name: string; species: string } | null;
}
