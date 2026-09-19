import { fetchTelemetryHistory, type HistoryQuery } from "../services/api";
import { usePollingResource, type PollingOptions } from "../services/use-polling-resource";
export function useTelemetryHistory(deviceId: string | null | undefined, query: HistoryQuery = {}, options: PollingOptions = {}) {
  const {limit=50,offset=0}=query;
  const resource=usePollingResource(deviceId ? JSON.stringify([deviceId,limit,offset]) : "",signal=>fetchTelemetryHistory(deviceId!,{limit,offset},{signal}),options);
  return {history:resource.data,readings:resource.data?.data ?? [],pagination:resource.data?.pagination ?? null,loading:resource.loading,error:resource.error,refreshData:resource.refresh};
}
