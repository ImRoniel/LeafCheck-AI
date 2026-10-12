import { isPlantNeedingAttention } from "./plant-attention";
import type { Plant } from "../types/plant";
import type { PlantTelemetry } from "../types/device";
import type { GardenCareTask } from "../types/care-task";
import type { ArchiveEntry } from "../types/scan";

export interface DashboardSensorSample { plantId: string; payload: PlantTelemetry | null; failed: boolean }
export type DashboardSensorStatus = "receiving" | "waiting" | "stale" | "error" | "checking" | "unpaired" | "demo";
export interface DashboardSensor {
  plant: Plant; status: DashboardSensorStatus; demo: boolean; address: string | null;
  name: string; timestamp: string | null;
}
export interface PlantHighlight { plant: Plant; reason: string; attention: boolean; rank: number }
export interface DashboardSummary {
  attention: PlantHighlight[]; highlights: PlantHighlight[]; dueToday: number; overdue: number;
  scannedToday: number; scansLimited: boolean; tasksLimited: boolean;
}
export function dashboardSensors(plants: readonly Plant[], samples: readonly DashboardSensorSample[], now: Date, failed = false): DashboardSensor[] {
  return plants.filter(plant => Boolean(plant.deviceId)).map(plant => {
    const sample = samples.find(item => item.plantId === plant.id);
    // A response from an old pairing must never describe the newly linked sensor.
    const payload = sample?.payload?.paired && sample.payload.device.id === plant.deviceId ? sample.payload : null;
    const demo = Boolean(plant.simulated || payload?.device.macAddress.startsWith("DEMO:"));
    const timestamp = payload?.telemetry?.timestamp ?? null;
    const age = timestamp ? now.getTime() - Date.parse(timestamp) : null;
    const status: DashboardSensorStatus = failed || sample?.failed ? "error"
      : sample?.payload && !sample.payload.paired ? "unpaired"
      : !payload ? "checking"
      : demo ? "demo"
      : age === null ? "waiting"
      : !Number.isFinite(age) || age > 30 * 60_000 || age < -60_000 ? "stale" : "receiving";
    return { plant, status, demo, timestamp, address: payload?.device.macAddress ?? null, name: payload?.device.name ?? "Linked sensor" };
  });
}
export function sensorStatusLabel(status: DashboardSensorStatus): string {
  switch (status) {
    case "receiving": return "Receiving readings";
    case "waiting": return "Paired · waiting for first reading";
    case "stale": return "Readings delayed · check sensor";
    case "error": return "Couldn’t refresh readings";
    case "checking": return "Checking sensor readings…";
    case "unpaired": return "No sensor linked";
    case "demo": return "Demo readings · simulated";
  }
}
export function readingTimeLabel(timestamp: string | null, now: Date): string {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(timestamp)) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${new Date(timestamp).toLocaleString()}`;
}
export function summarizeDashboard(plants: readonly Plant[], pending: readonly GardenCareTask[], archives: readonly ArchiveEntry[], now: Date, tasksLimited = false): DashboardSummary {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const owned = new Set(plants.map(plant => plant.id));
  const tasks = pending.filter(task => owned.has(task.plantId));
  const dueToday = tasks.filter(task => task.dueAt && Date.parse(task.dueAt) >= start.getTime() && Date.parse(task.dueAt) < end.getTime()).length;
  const overdue = tasks.filter(task => task.dueAt && Date.parse(task.dueAt) < now.getTime()).length;
  const ranked = plants.map((plant): PlantHighlight => {
    const care = tasks.filter(task => task.plantId === plant.id);
    const late = care.some(task => task.dueAt && Date.parse(task.dueAt) < now.getTime());
    const due = care.some(task => task.dueAt && Date.parse(task.dueAt) < end.getTime());
    const urgent = care.some(task => task.priority === "immediate" && (!task.dueAt || Date.parse(task.dueAt) < end.getTime()));
    if (plant.healthStatus === "critical") return { plant, rank: 100, attention: true, reason: "Health check · saved critical status" };
    if (plant.healthStatus === "warning") return { plant, rank: 90, attention: true, reason: "Health check · saved warning" };
    if (urgent) return { plant, rank: 80, attention: true, reason: "Care needs attention" };
    if (late) return { plant, rank: 70, attention: true, reason: "Overdue care" };
    if (due) return { plant, rank: 60, attention: true, reason: "Care due today" };
    return { plant, rank: plant.healthStatus === "unknown" ? 20 : 10, attention: false,
      reason: plant.healthStatus === "unknown" ? "Not assessed yet" : "Healthy · saved status" };
  }).sort((a, b) => b.rank - a.rank || a.plant.name.localeCompare(b.plant.name) || a.plant.id.localeCompare(b.plant.id));
  const today = archives.filter(entry => owned.has(entry.plantId) && Date.parse(entry.createdAt) >= start.getTime() && Date.parse(entry.createdAt) < end.getTime());
  const scansLimited = archives.length >= 50 && !archives.some(entry => Date.parse(entry.createdAt) < start.getTime());
  return { attention: ranked.filter(item => isPlantNeedingAttention(item.plant)), highlights: ranked.slice(0, 3), dueToday, overdue,
    scannedToday: new Set(today.map(entry => entry.plantId)).size, scansLimited, tasksLimited };
}
