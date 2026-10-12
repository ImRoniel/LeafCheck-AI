import type { SensorOverviewEntry } from "../types/device";
import type { DashboardSensorStatus } from "./dashboard-summary";
export function overviewReadingStatus(entry: SensorOverviewEntry, now: Date, listError = false): DashboardSensorStatus {
  if (listError || entry.readingError) return "error";
  if (entry.demo) return "demo";
  if (!entry.telemetry) return "waiting";
  const age = now.getTime() - Date.parse(entry.telemetry.timestamp);
  return !Number.isFinite(age) || age > 30 * 60_000 || age < -60_000 ? "stale" : "receiving";
}
