import { useAuth } from "@/context/auth";
import { api } from "@/services/api";
import { selectPlantGuidance } from "@/services/plant-guidance";
import { profileCareTasks } from "@/services/plant-profile-guidance";
import { usePollingResource } from "@/services/use-polling-resource";

export function usePlantProfileGuidance(plantId: string, enabled: boolean) {
  const auth = useAuth();
  const key = `${auth.generation}:${plantId}`;
  const resource = usePollingResource(enabled ? key : "", async signal => {
    const [archives, tasks] = await Promise.all([
      api.fetchArchives({ signal, plantId }), api.fetchTasks({ signal, plantId }),
    ]);
    const selected = selectPlantGuidance(plantId, archives, tasks);
    return { key, latest: selected.latest, pending: profileCareTasks(selected.pending) };
  }, { enabled, pollIntervalMs: 60_000 });
  return { ...resource, data: enabled && resource.data?.key === key ? resource.data : null };
}
