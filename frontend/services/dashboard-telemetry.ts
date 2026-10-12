import type { Plant } from "../types/plant";
import type { PlantTelemetry } from "../types/device";
import type { DashboardSensorSample } from "./dashboard-summary";

/** Bound fan-out and preserve each plant's error independently of its neighbours. */
export async function loadDashboardTelemetry(plants: readonly Plant[], signal: AbortSignal,
  fetchReading: (plantId: string, signal: AbortSignal) => Promise<PlantTelemetry>): Promise<DashboardSensorSample[]> {
  const linked = plants.filter(plant => Boolean(plant.deviceId));
  const samples: DashboardSensorSample[] = [];
  for (let offset = 0; offset < linked.length; offset += 4) {
    signal.throwIfAborted();
    const batch = linked.slice(offset, offset + 4);
    const readings = await Promise.allSettled(batch.map(plant => fetchReading(plant.id, signal)));
    signal.throwIfAborted();
    readings.forEach((result, index) => samples.push({ plantId: batch[index].id,
      payload: result.status === "fulfilled" ? result.value : null, failed: result.status === "rejected" }));
  }
  return samples;
}
