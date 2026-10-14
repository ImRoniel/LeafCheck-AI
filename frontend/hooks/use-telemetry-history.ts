import { fetchPlantTelemetryHistory, type PlantHistoryQuery } from "../services/api";
import { usePollingResource, type PollingOptions } from "../services/use-polling-resource";
export function useTelemetryHistory(plantId: string | null | undefined, query: PlantHistoryQuery = {}, options: PollingOptions = {}) {
  const {limit=50,offset=0,from,to}=query;
  const resource=usePollingResource(plantId ? JSON.stringify([plantId,limit,offset,from,to]) : "",signal=>fetchPlantTelemetryHistory(plantId!,{limit,offset,from,to},{signal}),options);
  return {history:resource.data,readings:resource.data?.data ?? [],pagination:resource.data?.pagination ?? null,loading:resource.loading,error:resource.error,refreshData:resource.refresh};
}
