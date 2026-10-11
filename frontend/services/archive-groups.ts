import type { ArchiveEntry } from "../types";
import { timestampMillis } from "./plant-profile-guidance";

export function groupArchives(entries: readonly ArchiveEntry[], plantId?: string) {
  const groups = new Map<string, { plantId: string; name: string; species: string; scans: ArchiveEntry[] }>();
  for (const entry of [...entries].sort((a, b) => (timestampMillis(b.createdAt) ?? 0) - (timestampMillis(a.createdAt) ?? 0))) {
    if (plantId && entry.plantId !== plantId) continue;
    let group = groups.get(entry.plantId);
    if (!group) {
      group = { plantId: entry.plantId, name: entry.plant?.name ?? entry.speciesName ?? "Unknown plant",
        species: entry.plant?.species ?? entry.speciesName ?? "Unidentified species", scans: [] };
      groups.set(entry.plantId, group);
    }
    group.scans.push(entry);
  }
  return [...groups.values()];
}
