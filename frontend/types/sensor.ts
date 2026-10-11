/** ESP32 ingestion fields; soil moisture is uncalibrated 12-bit ADC data. */
export interface HardwareTelemetryPayload {
  deviceId: string;
  temperature: number;
  humidity: number;
  soilMoisture: number;
  soilMoistureRaw?: number | null;
  lightLux: number;
}

export interface SoilMoisture { percentage: number | null; rawAnalogValue: number | null; status: "optimal" | "dry" | "overwatered" | "unavailable" }
export interface LightLevel { lux: number | null; status: "insufficient" | "optimal" | "excessive" | "unavailable" }
export interface EnvironmentalReadings { temperatureCelsius: number; humidityPercentage: number }
/** Live lux readings are not PAR; pH is species reference data, not telemetry. */
export interface TelemetryPayload {
  deviceId: string;
  timestamp: string;
  soilMoisture: SoilMoisture;
  lightLevel: LightLevel;
  environment: EnvironmentalReadings;
}
export interface SensorReading {
  id: string; deviceId: string; temperature: number; humidity: number;
  soilMoisture: number | null; soilMoistureRaw: number | null; lightLevel: number | null; timestamp: string;
}
export interface TelemetryHistory {
  data: SensorReading[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}
