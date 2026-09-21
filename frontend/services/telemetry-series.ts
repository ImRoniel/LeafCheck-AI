import type { SensorReading } from "../types/sensor";

export function chronologicalReadings(readings: SensorReading[]) {
  return [...readings].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
}

export function metricSeries(
  readings: SensorReading[],
  metric: "soilMoisture" | "temperature" | "humidity" | "lightLevel",
) {
  return readings.map((reading) => ({
    id: reading.id,
    timestamp: reading.timestamp,
    value: reading[metric],
  }));
}
