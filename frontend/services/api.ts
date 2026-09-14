import { TelemetryPayload, Plant } from "../types";
import { AIDiagnosisRequest, AIDiagnosisResponse } from "../types/ai";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

// ─── Telemetry ────────────────────────────────────────────────────────────────

/**
 * Fetches the latest sensor telemetry reading for a given device from the backend.
 */
export const fetchLatestTelemetry = async (
  deviceId: string
): Promise<TelemetryPayload | null> => {
  try {
    const res = await fetch(`${BASE_URL}/api/telemetry/${deviceId}/latest`);
    if (!res.ok) return null;
    return (await res.json()) as TelemetryPayload;
  } catch (error) {
    console.error("[API] fetchLatestTelemetry error:", error);
    return null;
  }
};

// ─── Plants ───────────────────────────────────────────────────────────────────

/**
 * Fetches all plants registered to the current user from the backend.
 */
export const fetchUserPlants = async (): Promise<Plant[]> => {
  try {
    const res = await fetch(`${BASE_URL}/api/plants`);
    if (!res.ok) return [];
    return (await res.json()) as Plant[];
  } catch (error) {
    console.error("[API] fetchUserPlants error:", error);
    return [];
  }
};

// ─── AI Diagnosis ─────────────────────────────────────────────────────────────

/**
 * Sends a foliage analysis request to the backend, which proxies to Gemini AI.
 * The Gemini API key is NEVER exposed to the mobile client.
 */
export const analyzePlant = async (
  request: AIDiagnosisRequest
): Promise<AIDiagnosisResponse> => {
  try {
    const res = await fetch(`${BASE_URL}/api/ai/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      throw new Error(`AI endpoint returned ${res.status}`);
    }
    return (await res.json()) as AIDiagnosisResponse;
  } catch (error: any) {
    return {
      success: false,
      healthStatus: "unknown",
      diagnoses: [],
      recommendations: [],
      timestamp: new Date().toISOString(),
      error: error?.message ?? "Failed to reach the analysis backend.",
    };
  }
};
