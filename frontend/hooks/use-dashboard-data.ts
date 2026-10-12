import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import { api } from "@/services/api";
import { usePollingResource } from "@/services/use-polling-resource";
import { loadDashboardTelemetry } from "@/services/dashboard-telemetry";
import { dashboardSensors, summarizeDashboard } from "@/services/dashboard-summary";
import { buildCareTasks } from "@/services/care-tasks";
import { useDeviceActivity } from "./use-device-activity";
import type { Plant } from "@/types/plant";

export function useDashboardTelemetry(plants: readonly Plant[], enabled: boolean) {
  const auth = useAuth();
  const active = useDeviceActivity();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(new Date());
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [active]);
  const key = JSON.stringify([auth.generation, plants.filter(plant => plant.deviceId).map(plant => [plant.id, plant.deviceId]).sort()]);
  const resource = usePollingResource(enabled ? key : "", async signal => ({ key,
    samples: await loadDashboardTelemetry(plants, signal, (plantId, signal) => api.fetchPlantTelemetry(plantId, { signal })),
  }), { enabled: enabled && active, pollIntervalMs: 30_000 });
  const samples = enabled && resource.data?.key === key ? resource.data.samples : [];
  return { ...resource, now, sensors: enabled ? dashboardSensors(plants, samples, now, Boolean(resource.error)) : [] };
}
export function useDashboardData() {
  const data = useAppData();
  const local = useLocalState();
  const auth = useAuth();
  const active = useDeviceActivity();
  const enabled = !data.guest && data.loaded;
  const telemetry = useDashboardTelemetry(data.plants, enabled);
  const taskKey = `dashboard-tasks:${auth.generation}`;
  const scanKey = `dashboard-scans:${auth.generation}`;
  const tasks = usePollingResource(enabled ? taskKey : "", async signal => ({ key: taskKey, items: await api.fetchTasks({ signal }) }), { enabled: enabled && active, pollIntervalMs: 60_000 });
  const scans = usePollingResource(enabled ? scanKey : "", async signal => ({ key: scanKey, items: await api.fetchArchives({ signal, days: 7 }) }), { enabled: enabled && active, pollIntervalMs: 60_000 });
  const serverTasks = enabled && tasks.data?.key === taskKey ? tasks.data.items : [];
  const archives = enabled && scans.data?.key === scanKey ? scans.data.items : [];
  const built = buildCareTasks(data.plants, local.data.schedules, local.data.careCompletions, telemetry.now, serverTasks);
  const summary = summarizeDashboard(data.plants, [...built.today, ...built.upcoming], archives, telemetry.now, serverTasks.length >= 50);
  const ready = data.loaded && local.ready;
  const careReady = ready && (data.guest || (tasks.data?.key === taskKey && !tasks.error));
  const scansReady = enabled && scans.data?.key === scanKey && !scans.error;
  const error = data.error ? "Couldn’t refresh your garden." : local.error ? "Couldn’t load saved care." : null;
  const refresh = async () => {
    await Promise.allSettled([data.refresh(), local.error ? local.retry() : Promise.resolve(),
      ...(enabled ? [telemetry.refresh(), tasks.refresh(), scans.refresh()] : [])]);
  };
  return { data, summary, sensors: telemetry.sensors, now: telemetry.now, ready, careReady, scansReady, error,
    careError: Boolean(tasks.error), scansError: Boolean(scans.error),
    refreshing: data.loading || telemetry.loading || tasks.loading || scans.loading, refresh };
}
