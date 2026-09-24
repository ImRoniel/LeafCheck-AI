import { useAppData } from "./app-data";
import { useLocalState } from "./local-state";
export function useSpaces() {
  const { plants } = useAppData();
  const { data } = useLocalState();
  const groups = new Map<string, typeof plants>();
  data.spaces.forEach((space) => groups.set(space.name, []));
  plants.forEach((plant) => {
    const location = plant.location?.trim() || "Unassigned";
    groups.set(location, [...(groups.get(location) ?? []), plant]);
  });
  return {
    spaces: [...groups.keys()],
    plantsBySpace: Object.fromEntries(groups),
    backgrounds: Object.fromEntries(
      [...groups.keys()].map((name, index) => [
        name,
        ["#E8F2E8", "#E3EFEF", "#F3EBD8", "#EDE6F1", "#F5E5DE"][index % 5],
      ]),
    ),
  };
}
