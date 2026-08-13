export interface SoilMoisture {
  percentage: number; // 0 to 100 %
  rawAnalogValue: number;
  status: 'optimal' | 'dry' | 'overwatered';
}

export interface PHLevel {
  value: number; // e.g. 6.5
  status: 'acidic' | 'neutral' | 'alkaline' | 'optimal';
}

export interface PARLight {
  ppfd: number; // Photosynthetic Photon Flux Density (µmol/m²/s)
  dailyLightIntegral?: number; // DLI (mol/m²/day)
  status: 'insufficient' | 'optimal' | 'excessive';
}

export interface EnvironmentalReadings {
  temperatureCelsius: number;
  humidityPercentage: number;
}

export interface TelemetryPayload {
  deviceId: string;
  timestamp: string;
  soilMoisture: SoilMoisture;
  phLevel: PHLevel;
  parLight: PARLight;
  environment?: EnvironmentalReadings;
}
