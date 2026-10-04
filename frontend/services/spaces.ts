import type { LocalState, LocalSpace } from "../types/local-state";
import type { Plant } from "../types/plant";
export const spaceBackgrounds = ["#E8F2E8", "#E3EFEF", "#F3EBD8", "#EDE6F1", "#F5E5DE"] as const;
export function groupSpaces(metadata: LocalSpace[], plants: Plant[]) {
  const groups = new Map<string, Plant[]>();
  metadata.forEach(s => { if (!s.status) groups.set(s.name, []); });
  plants.forEach(plant => {
    const raw = plant.location?.trim() || "Unassigned";
    const match = metadata.find(s => s.name.toLowerCase() === raw.toLowerCase());
    if (match?.status) return;
    const name = match?.name ?? raw;
    groups.set(name, [...(groups.get(name) ?? []), plant]);
  });
  return {
    spaces: [...groups.keys()], plantsBySpace: Object.fromEntries(groups),
    backgrounds: Object.fromEntries([...groups.keys()].map((name, index) =>
      [name, metadata.find(s => s.name === name)?.background ?? spaceBackgrounds[index % 5]])),
  };
}
export function createSpace(state: LocalState, raw: string, background: string, locations: string[]) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter a space name.");
  if (name.length > 10) throw new Error("Space names must be 10 characters or fewer.");
  if (name.toLowerCase() === "unassigned") throw new Error("Choose a name other than Unassigned.");
  if ([...state.spaces.map(s => s.name), ...locations].some(s => s.toLowerCase() === name.toLowerCase()))
    throw new Error("That space already exists.");
  if (!spaceBackgrounds.some(c => c === background)) throw new Error("Choose a background.");
  return { ...state, spaces: [...state.spaces, {
    id: `space-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, background,
    theme: "living" as const, light: "medium" as const, createdAt: new Date().toISOString(),
  }] };
}
export function manageSpace(state: LocalState, name: string, status?: "archived" | "deleted") {
  if (name === "Unassigned") throw new Error("Unassigned is not a space to manage.");
  const existing = state.spaces.find(s => s.name === name);
  const space: LocalSpace = existing ?? {
    id: `space-${Date.now()}-${Math.random().toString(36).slice(2)}`, name,
    theme: "living", light: "medium", createdAt: new Date().toISOString(),
  };
  return { ...state, spaces: [...state.spaces.filter(s => s.id !== space.id), { ...space, status }] };
}
export function validateManualPlant(plants: Plant[], raw: string, species: string) {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || !species.trim()) throw new Error("Enter a plant name and species.");
  if (name.length > 10) throw new Error("Plant names must be 10 characters or fewer.");
  if (plants.length >= 8) throw new Error("Each space can have a maximum of 8 manually added plants.");
  if (plants.some(p => p.name.toLowerCase() === name.toLowerCase()))
    throw new Error("That plant already exists in this space.");
  return name;
}
export function scanSpaceLocation(space: unknown, plantId?: string) {
  return !plantId && typeof space === "string" && space !== "Unassigned" && space.trim()
    ? { location: space.trim() } : {};
}
