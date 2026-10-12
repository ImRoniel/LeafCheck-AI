import type { ApiError } from "./errors";
import type { SensorOverviewEntry } from "../types/device";
import type { DashboardSensorStatus } from "./dashboard-summary";
export function overviewReadingStatus(entry: SensorOverviewEntry, now: Date, listError = false): DashboardSensorStatus {
  if (listError || entry.readingError) return "error";
  if (entry.demo) return "demo";
  if (!entry.telemetry) return "waiting";
  const age = now.getTime() - Date.parse(entry.telemetry.timestamp);
  return !Number.isFinite(age) || age > 30 * 60_000 || age < -60_000 ? "stale" : "receiving";
}

export function sensorOverviewErrorMessage(error: Pick<ApiError, "kind" | "status"> | null): string | null {
  if (!error) return null;
  if (error.status === 401 || error.status === 403) return "Sign in again to view your sensors.";
  if (error.status === 404) return "Sensor overview is unavailable on the server. Please try again later.";
  if (error.kind === "network" || error.kind === "timeout") return "Couldn’t reach the sensor service. Check your connection and retry.";
  if (error.kind === "validation") return "Sensor details could not be read. Please refresh.";
  return "Couldn’t refresh the sensor overview. Please retry.";
}
