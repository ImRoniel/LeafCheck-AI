import { useAuth } from "@/context/auth";
import { api } from "@/services/api";
import { selectPlantGuidance } from "@/services/plant-guidance";
import { profileCareTasks } from "@/services/plant-profile-guidance";
import { usePollingResource } from "@/services/use-polling-resource";

export function usePlantProfileGuidance(plantId: string, enabled: boolean) {
  const auth = useAuth();
  const key = `${auth.generation}:${plantId}`;
  const archives = usePollingResource(enabled ? `${key}:archives` : "", async signal => {
    const rows = await api.fetchArchives({ signal, plantId });
    return { key, latest: selectPlantGuidance(plantId, rows, []).latest };
  }, { enabled, pollIntervalMs: 60_000 });
  const tasks = usePollingResource(enabled ? `${key}:tasks` : "", async signal => {
    const rows = await api.fetchTasks({ signal, plantId });
    return { key, pending: profileCareTasks(selectPlantGuidance(plantId, [], rows).pending) };
  }, { enabled, pollIntervalMs: 60_000 });
  return {
    data: { latest: enabled && archives.data?.key === key ? archives.data.latest : null,
      pending: enabled && tasks.data?.key === key ? tasks.data.pending : [] },
    loading: archives.loading, error: archives.error,
    tasksLoading: tasks.loading, tasksError: tasks.error,
    refresh: () => Promise.allSettled([archives.refresh(), tasks.refresh()]),
    refreshDiagnosis: archives.refresh, refreshTasks: tasks.refresh,
  };
}
