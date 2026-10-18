import { assignLocalPlant, createSpace, groupSpaces, isUnassignedPlant, manageSpace, validateManualPlant } from "@/services/spaces";
import { useAppData } from "./app-data";
import { useLocalState } from "./local-state";
export function useSpaces() {
  const app = useAppData();
  const local = useLocalState();
  const groups = groupSpaces(local.data.spaces, app.plants);
  return {
    ...groups,
    unassignedPlants: app.plants.filter(plant => isUnassignedPlant(plant, local.data.spaces)),
    ready: local.ready, error: local.error, retry: local.retry,
    archivedSpaces: local.data.spaces.filter(s => s.status === "archived"),
    addSpace: (name: string, background: string) => local.update(state =>
      createSpace(state, name, background, app.plants.map(p => p.location?.trim() || "Unassigned"))),
    archiveSpace: (name: string) => local.update(state => manageSpace(state, name, "archived")),
    deleteSpace: async (name: string) => {
      if (!local.ready) throw new Error("Spaces are still loading. Please try again.");
      if (!app.guest && (!app.loaded || app.loading || app.error)) {
        throw new Error("Refresh your plants before deleting this space. Your collection is still loading or could not be refreshed.");
      }
      // Validate before moving records. Keep the space visible if any server
      // move fails, so retrying can finish the remaining plants safely.
      manageSpace(local.data, name, "deleted");
      if (!app.guest) {
        for (const plant of app.plants.filter(item => item.location?.trim().toLowerCase() === name.toLowerCase())) {
          await app.updatePlant(plant.id, { location: null });
        }
      }
      await local.update(state => manageSpace(state, name, "deleted"));
    },
    restoreSpace: (name: string) => local.update(state => manageSpace(state, name)),
    assignPlant: async (space: string, plantId: string) => {
      if (!local.ready || !groups.spaces.includes(space) || space.trim().toLowerCase() === "unassigned") throw new Error("This space is unavailable.");
      const plant = app.plants.find(item => item.id === plantId);
      if (!plant || !isUnassignedPlant(plant, local.data.spaces)) throw new Error("This plant is no longer unassigned. Refresh your plants and try again.");
      if (app.guest) await local.update(state => assignLocalPlant(state, plantId, space));
      else await app.updatePlant(plantId, { location: space });
    },
    addPlant: async (space: string, raw: string, species: string) => {
      if (!local.ready || !groups.spaces.includes(space)) throw new Error("This space is unavailable.");
      const name = validateManualPlant(groups.plantsBySpace[space] ?? [], raw, species);
      await app.createPlant({ name, species: species.trim(), location: space === "Unassigned" ? undefined : space });
    },
  };
}
