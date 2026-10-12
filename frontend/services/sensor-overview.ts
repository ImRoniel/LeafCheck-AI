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

const statusPriority: Record<DashboardSensorStatus, number> = {
  error: 0, stale: 1, waiting: 2, checking: 2, unpaired: 2, receiving: 3, demo: 4,
};

export interface SensorOverviewGroup {
  key: string;
  title: string;
  plants: SensorOverviewEntry["plants"];
  entries: SensorOverviewEntry[];
  status: DashboardSensorStatus;
  attentionCount: number;
}

/** Keep shared devices in one group, rather than repeating a sensor for every linked plant. */
export function groupSensorOverview(entries: readonly SensorOverviewEntry[], query: string, now: Date, listError = false): SensorOverviewGroup[] {
  const search = query.trim().toLocaleLowerCase();
  const groups = new Map<string, SensorOverviewGroup>();
  const priority = (entry: SensorOverviewEntry) => statusPriority[overviewReadingStatus(entry, now, listError)];
  for (const entry of entries) {
    if (search && ![entry.device.macAddress, entry.device.name, ...entry.plants.map(plant => plant.name)]
      .some(value => value.toLocaleLowerCase().includes(search))) continue;
    const plants = [...entry.plants].sort((a, b) => a.id.localeCompare(b.id));
    const key = JSON.stringify(plants.map(plant => plant.id));
    const group = groups.get(key) ?? {
      key, title: plants.map(plant => plant.name).join(" · ") || "Unlinked devices", plants,
      entries: [], status: overviewReadingStatus(entry, now, listError), attentionCount: 0,
    };
    const status = overviewReadingStatus(entry, now, listError);
    if (statusPriority[status] < statusPriority[group.status]) group.status = status;
    if (statusPriority[status] <= statusPriority.waiting) group.attentionCount++;
    group.entries.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.entries.sort((a, b) => priority(a) - priority(b)
    || a.device.macAddress.localeCompare(b.device.macAddress) || a.device.id.localeCompare(b.device.id));
  return [...groups.values()].sort((a, b) => statusPriority[a.status] - statusPriority[b.status]
    || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

export function sensorOverviewErrorMessage(error: Pick<ApiError, "kind" | "status"> | null): string | null {
  if (!error) return null;
  if (error.status === 401 || error.status === 403) return "Sign in again to view your sensors.";
  if (error.status === 404) return "Sensor overview is unavailable on the server. Please try again later.";
  if (error.kind === "network" || error.kind === "timeout") return "Couldn’t reach the sensor service. Check your connection and retry.";
  if (error.kind === "validation") return "Sensor details could not be read. Please refresh.";
  return "Couldn’t refresh the sensor overview. Please retry.";
}
