import type { TelemetryPayload } from "./sensor";

export interface Device {
  id: string;
  name: string;
  macAddress: string;
  userId: string;
  status: "ONLINE" | "OFFLINE" | "SIMULATED";
  createdAt: string;
  updatedAt: string;
}

export type PlantTelemetry =
  | { paired: false; device: null; telemetry: null }
  | { paired: true; device: Device; telemetry: TelemetryPayload | null };

/** Owner-scoped account inventory, with each device's latest received sample. */
export interface SensorOverviewEntry {
  device: Device;
  plants: { id: string; name: string }[];
  demo: boolean;
  readingError: boolean;
  telemetry: TelemetryPayload | null;
}
