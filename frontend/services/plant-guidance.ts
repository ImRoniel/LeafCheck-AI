import type { ArchiveEntry, CareTask } from "../types";

export function selectPlantGuidance(plantId: string, archives: readonly ArchiveEntry[], tasks: readonly CareTask[]) {
  const latest = archives
    .filter((entry) => entry.plantId === plantId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
  const pending = tasks
    .filter((task) => task.plantId === plantId && task.status === "PENDING")
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
  return { latest, pending };
}

export function telemetryGuidance(
  timestamp: string | null | undefined,
  options: { failed?: boolean; linked?: boolean; simulated?: boolean } = {},
  now = Date.now(),
) {
  if (options.failed) return { degraded: true, message: "Current readings could not be refreshed. Check the plant before following saved care advice." };
  if (!options.linked) return { degraded: true, message: "No verified sensor link. Saved advice is based on the scan; check soil and growing conditions before acting." };
  if (!timestamp) return { degraded: true, message: "No current sensor readings are available. Check the plant before following saved care advice." };
  const age = now - Date.parse(timestamp);
  if (!Number.isFinite(age) || age < -60_000) return { degraded: true, message: "The sensor timestamp could not be verified. Current growing conditions are unknown." };
  if (age > 30 * 60_000) return { degraded: true, message: "Sensor readings are stale (over 30 minutes old). Refresh readings or check the plant before acting on saved advice." };
  if (options.simulated) return { degraded: true, message: "These readings are simulated. Check the real plant before following saved care advice." };
  return { degraded: false, message: "Recent sensor readings are available. Saved care advice reflects the conditions at the time of the scan." };
}
