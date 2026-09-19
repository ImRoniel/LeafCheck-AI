export interface SoilMoisture { percentage: number; rawAnalogValue: number; status: "optimal" | "dry" | "overwatered" }
export interface LightLevel { lux: number; status: "insufficient" | "optimal" | "excessive" }
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
  soilMoisture: number; soilMoistureRaw: number | null; lightLevel: number | null; timestamp: string;
}
export interface TelemetryHistory {
  data: SensorReading[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}
