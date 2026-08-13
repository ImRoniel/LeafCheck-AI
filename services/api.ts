import { supabase } from "./supabase";
import { TelemetryPayload, Plant } from "../types";

export const fetchLatestTelemetry = async (deviceId: string): Promise<TelemetryPayload | null> => {
  try {
    const { data, error } = await supabase
      .from("telemetry")
      .select("*")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      deviceId: data.device_id,
      timestamp: data.created_at,
      soilMoisture: {
        percentage: data.soil_moisture_pct ?? 0,
        rawAnalogValue: data.soil_moisture_raw ?? 0,
        status: data.soil_moisture_pct > 70 ? "overwatered" : data.soil_moisture_pct < 30 ? "dry" : "optimal",
      },
      phLevel: {
        value: data.ph_value ?? 7.0,
        status: data.ph_value < 6.0 ? "acidic" : data.ph_value > 7.5 ? "alkaline" : "optimal",
      },
      parLight: {
        ppfd: data.par_ppfd ?? 0,
        status: data.par_ppfd < 100 ? "insufficient" : data.par_ppfd > 800 ? "excessive" : "optimal",
      },
      environment: {
        temperatureCelsius: data.temperature ?? 24,
        humidityPercentage: data.humidity ?? 55,
      },
    };
  } catch (error) {
    console.error("Error fetching telemetry:", error);
    return null;
  }
};

export const fetchUserPlants = async (): Promise<Plant[]> => {
  try {
    const { data, error } = await supabase
      .from("plants")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map((item: any) => ({
      id: item.id,
      name: item.name,
      species: item.species,
      location: item.location,
      healthStatus: item.health_status || "healthy",
      lastScannedAt: item.last_scanned_at,
      imageUrl: item.image_url,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
  } catch (error) {
    console.error("Error fetching plants:", error);
    return [];
  }
};
