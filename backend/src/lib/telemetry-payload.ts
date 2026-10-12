import type { TelemetryPayload } from "../types/sensor.js";
interface Reading {
  timestamp: Date; temperature: number; humidity: number;
  soilMoisture?: number | null; soilMoistureRaw?: number | null;
  lightLevel?: number | null; lightLux?: number | null;
}
/** Physical moisture is raw ADC; only virtual demo readings have calibrated percentages. */
export function serializeTelemetry(reading: Reading, deviceId: string, isDemo: boolean, minMoisture = 30, maxMoisture = 80): TelemetryPayload {
  const lux = isDemo ? reading.lightLevel ?? null : reading.lightLux ?? null;
  return {
    deviceId, timestamp: reading.timestamp.toISOString(),
    soilMoisture: {
      percentage: isDemo ? reading.soilMoisture ?? null : null,
      rawAnalogValue: isDemo ? reading.soilMoistureRaw ?? null : reading.soilMoistureRaw ?? reading.soilMoisture ?? null,
      status: !isDemo || reading.soilMoisture == null ? "unavailable" : reading.soilMoisture > maxMoisture ? "overwatered" : reading.soilMoisture < minMoisture ? "dry" : "optimal",
    },
    lightLevel: { lux, status: lux == null ? "unavailable" : lux < 500 ? "insufficient" : lux > 50_000 ? "excessive" : "optimal" },
    environment: { temperatureCelsius: reading.temperature, humidityPercentage: reading.humidity },
  };
}
