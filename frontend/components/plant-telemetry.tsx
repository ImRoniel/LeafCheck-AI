import type { Plant, PlantTelemetry as SensorState } from "@/types";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { MetricCard } from "./metric-card";
import { Action, ui } from "./screen";
import { TelemetryHistory } from "./telemetry-history";

export function PlantTelemetry({ plant, payload, loading, error, onRefresh, onPair, authenticated = true }: {
  plant: Plant; payload: SensorState | null; loading: boolean; error: string | null;
  onRefresh: () => void; onPair: () => void; authenticated?: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [showCalibration, setShowCalibration] = useState(false);
  const telemetry = payload?.paired ? payload.telemetry : null;
  const paired = payload?.paired ?? Boolean(plant.deviceId);
  const age = telemetry ? Date.now() - Date.parse(telemetry.timestamp) : null;
  const stale = age !== null && (!Number.isFinite(age) || age > 30 * 60_000 || age < -60_000);
  const message = !authenticated ? "Sign in to connect a sensor."
    : error ? "Sensor readings could not be refreshed."
    : loading ? "Updating sensor readings…"
    : !paired ? "Connect a sensor to monitor growing conditions."
    : !telemetry ? "Sensor linked. Waiting for first sensor reading…"
    : plant.simulated ? "Demo readings · Simulated sensor data"
    : stale ? "Readings are out of date. Refresh to check current conditions." : null;
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.heading}>Growing Conditions</Text>
    {loading && <ActivityIndicator accessibilityLabel="Loading sensor readings" />}
    {message && <Text accessibilityLiveRegion="polite" style={ui.text}>{message}</Text>}
    {payload?.paired && <Text style={ui.text}>{payload.device.name}</Text>}
    {telemetry && <>
      <Text style={ui.text}>Last updated · {new Date(telemetry.timestamp).toLocaleString()}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <MetricCard compact title="Temperature" value={telemetry.environment.temperatureCelsius} unit="°C" />
        <MetricCard compact title="Humidity" value={telemetry.environment.humidityPercentage} unit="%" />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <MetricCard compact title="Soil moisture · Raw ADC" value={telemetry.soilMoisture.rawAnalogValue ?? "Unavailable"} unit={telemetry.soilMoisture.rawAnalogValue == null ? undefined : "ADC"} onPress={() => setShowCalibration(value => !value)} />
        <MetricCard compact title="Light" value={telemetry.lightLevel.lux ?? "Unavailable"} unit={telemetry.lightLevel.lux == null ? undefined : "lux"} />
      </View>
      {showCalibration && <Text style={ui.text}>Soil moisture is a raw ADC reading from 0–4095. A percentage requires calibration.</Text>}
    </>}
    {authenticated && !paired && !loading && !error && <Action label="Pair a Sensor" variant="secondary" onPress={onPair} />}
    {authenticated && (paired || error) && <Action label={error ? "Retry sensor readings" : "Refresh readings"} variant="secondary" disabled={loading} onPress={onRefresh} />}
    {authenticated && <>
      <Action label={showHistory ? "Hide reading history" : "Reading history"} variant="secondary" onPress={() => setShowHistory(value => !value)} />
      {showHistory && <TelemetryHistory key={plant.id} plantId={plant.id} />}
    </>}
  </View>;
}
