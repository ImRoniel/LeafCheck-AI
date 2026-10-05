import type { TelemetryPayload } from "./sensor";

export interface Device {
  id: string;
  name: string;
  macAddress: string;
  userId: string;
  status: "ONLINE" | "OFFLINE";
  createdAt: string;
  updatedAt: string;
}

export type PlantTelemetry =
  | { paired: false; device: null; telemetry: null }
  | { paired: true; device: Device; telemetry: TelemetryPayload | null };
