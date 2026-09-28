import type { Plant } from "../types/plant";

export function filterPlants(plants: readonly Plant[], query: string): Plant[] {
  const term = query.trim().toLocaleLowerCase();
  return plants.filter((plant) =>
    [plant.name, plant.species, plant.location ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(term),
    ),
  );
}
