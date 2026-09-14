export interface SoilMoisture {
  percentage: number;
  rawAnalogValue: number;
  status: "optimal" | "dry" | "overwatered";
}

export interface PHLevel {
  value: number;
  status: "acidic" | "neutral" | "alkaline" | "optimal";
}

export interface PARLight {
  ppfd: number;
  dailyLightIntegral?: number;
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
 */
export interface TelemetryPayload {
  deviceId: string;
  timestamp: string;
  soilMoisture: SoilMoisture;
  phLevel: PHLevel;
  parLight: PARLight;
  environment?: EnvironmentalReadings;
}
