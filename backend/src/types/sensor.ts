export interface SoilMoisture {
  percentage: number;
  rawAnalogValue: number;
  status: "optimal" | "dry" | "overwatered";
}

export interface LightLevel {
  lux: number;
  status: "insufficient" | "optimal" | "excessive";
}

export interface EnvironmentalReadings {
  temperatureCelsius: number;
  humidityPercentage: number;
}

/**
 * TelemetryPayload — canonical payload shape shared across:
 *   - ESP32 firmware HTTP POST  (hardware/firmware/src/main.cpp)
 *   - Backend GET /api/telemetry/:deviceId/latest response
 *   - Frontend useSensorData hook
 *
 * NOTE: pH is NOT included — it is botanical reference data stored
 *       in PlantSpecCache, not a live sensor reading.
 */
export interface TelemetryPayload {
  deviceId: string;
  timestamp: string;
  soilMoisture: SoilMoisture;
  lightLevel: LightLevel;
  environment: EnvironmentalReadings;
}
