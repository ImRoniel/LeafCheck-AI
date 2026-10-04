import { createSpace, groupSpaces, manageSpace, validateManualPlant } from "@/services/spaces";
import { useAppData } from "./app-data";
import { useLocalState } from "./local-state";
export function useSpaces() {
  const app = useAppData();
  const local = useLocalState();
  const groups = groupSpaces(local.data.spaces, app.plants);
  return {
    ...groups,
    ready: local.ready, error: local.error, retry: local.retry,
    archivedSpaces: local.data.spaces.filter(s => s.status === "archived"),
    addSpace: (name: string, background: string) => local.update(state =>
      createSpace(state, name, background, app.plants.map(p => p.location?.trim() || "Unassigned"))),
    archiveSpace: (name: string) => local.update(state => manageSpace(state, name, "archived")),
    deleteSpace: (name: string) => local.update(state => manageSpace(state, name, "deleted")),
    restoreSpace: (name: string) => local.update(state => manageSpace(state, name)),
    addPlant: async (space: string, raw: string, species: string) => {
      if (!local.ready || !groups.spaces.includes(space)) throw new Error("This space is unavailable.");
      const name = validateManualPlant(groups.plantsBySpace[space] ?? [], raw, species);
      await app.createPlant({ name, species: species.trim(), location: space === "Unassigned" ? undefined : space });
    },
  };
}
