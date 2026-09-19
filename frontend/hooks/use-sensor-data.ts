import { fetchLatestTelemetry } from "../services/api";
import { usePollingResource, type PollingOptions } from "../services/use-polling-resource";
export function useSensorData(deviceId: string | null | undefined, options: PollingOptions = {}) {
  const resource=usePollingResource(deviceId ?? "",signal=>fetchLatestTelemetry(deviceId!,{signal}),options);
  return {telemetry:resource.data,loading:resource.loading,error:resource.error,refreshData:resource.refresh};
}
