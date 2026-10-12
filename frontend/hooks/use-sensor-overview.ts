import { useAuth } from "@/context/auth";
import { api } from "@/services/api";
import { usePollingResource } from "@/services/use-polling-resource";
import { useDeviceActivity } from "./use-device-activity";
export function useSensorOverview() {
  const auth = useAuth();
  const active = useDeviceActivity();
  const enabled = auth.status === "authenticated" && active;
  const key = `sensor-overview:${auth.generation}`;
  const resource = usePollingResource(enabled ? key : "", async signal => ({ key, entries: await api.fetchSensorOverview({ signal }) }), { enabled, pollIntervalMs: 30_000 });
  const snapshot = enabled && resource.data?.key === key ? resource.data : null;
  return { ...resource, ready: snapshot !== null, entries: snapshot?.entries ?? [] };
}
