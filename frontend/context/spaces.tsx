import { useAppData } from './app-data';
export function useSpaces() {
  const { plants } = useAppData();
  const groups = new Map<string, typeof plants>();
  plants.forEach(plant => { const location = plant.location?.trim() || 'Unassigned'; groups.set(location, [...(groups.get(location) ?? []), plant]); });
  return { spaces: [...groups.keys()], plantsBySpace: Object.fromEntries(groups), backgrounds: Object.fromEntries([...groups.keys()].map((name, index) => [name, ['#E8F2E8', '#E3EFEF', '#F3EBD8', '#EDE6F1', '#F5E5DE'][index % 5]])) };
}
