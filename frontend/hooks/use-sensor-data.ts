import { useState, useEffect } from "react";
import { TelemetryPayload } from "../types";
import { fetchLatestTelemetry } from "../services";

export const useSensorData = (deviceId: string) => {
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLatestTelemetry(deviceId);
      setTelemetry(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load telemetry data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (deviceId) {
      refreshData();
    }
  }, [deviceId]);

  return { telemetry, loading, error, refreshData };
};
