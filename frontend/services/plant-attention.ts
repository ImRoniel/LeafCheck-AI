import type { Plant } from "../types/plant";
export function isPlantNeedingAttention(plant: Plant): boolean {
  return plant.healthStatus === "warning" || plant.healthStatus === "critical";
}
export function plantsNeedingAttention(plants: readonly Plant[]): Plant[] {
  return plants.filter(isPlantNeedingAttention)
    .sort((a, b) => (a.healthStatus === b.healthStatus ? 0 : a.healthStatus === "critical" ? -1 : 1)
      || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
