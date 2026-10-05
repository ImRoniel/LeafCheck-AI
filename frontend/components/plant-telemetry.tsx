import type { Plant, PlantTelemetry as SensorState } from "@/types";
import { PlantCareSummary } from "./plant-care-summary";
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { MetricCard } from "./metric-card";
import { Action, Notice, ui } from "./screen";
import { TelemetryHistory } from "./telemetry-history";

export function PlantTelemetry({ plant, payload, loading, error, onRefresh, onPair }: {
  plant: Plant;
  payload: SensorState | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onPair: () => void;
}) {
  const [historyMac, setHistoryMac] = useState<string | null>(null);
  const telemetry = payload?.telemetry ?? null;
  return <View style={{ gap: 16 }}>
    <PlantCareSummary key={plant.id} plant={plant} telemetry={telemetry} telemetryError={Boolean(error)} linked={payload?.paired ?? false} />
    <Text accessibilityRole="header" style={ui.heading}>Growing conditions</Text>
    {loading && <><ActivityIndicator accessibilityLabel="Loading sensor readings" /><Notice>Updating sensor readings...</Notice></>}
    {error && <><Notice>{error}</Notice><Action label="Retry sensor readings" onPress={onRefresh} /></>}
    {!loading && !error && payload?.paired === false && <View style={ui.card}>
      <Text accessibilityRole="header" style={ui.heading}>No sensor paired</Text>
      <Action label="Pair a Sensor" onPress={onPair} />
    </View>}
    {!loading && !error && payload?.paired && <View style={ui.card}>
      <Text accessibilityRole="header" style={ui.heading}>{payload.device.name}</Text>
      {!telemetry && <Notice>Waiting for first sensor reading...</Notice>}
      {telemetry && <>
        <Text style={ui.text}>Last sample: {new Date(telemetry.timestamp).toLocaleString()}</Text>
        <View style={ui.row}>
          <MetricCard title="Temperature" value={telemetry.environment.temperatureCelsius} unit="°C" />
          <MetricCard title="Humidity" value={telemetry.environment.humidityPercentage} unit="%" />
          <MetricCard title="Soil moisture" value={telemetry.soilMoisture.percentage} unit="%" />
          <MetricCard title="Light" value={telemetry.lightLevel.lux} unit="lux" />
        </View>
      </>}
      <Action label="Show reading history" onPress={() => setHistoryMac(payload.device.macAddress)} />
      {historyMac === payload.device.macAddress && <TelemetryHistory key={historyMac} deviceId={historyMac} />}
    </View>}
    <Action label="Refresh latest reading" disabled={loading} onPress={onRefresh} />
  </View>;
}
