import { useSensorData } from "@/hooks/use-sensor-data";
import { Text, View } from "react-native";
import { MetricCard } from "./metric-card";
import { Action, Notice, ui } from "./screen";
import { TelemetryHistory } from "./telemetry-history";

export function PlantTelemetry({
  deviceId,
  linked = false,
}: {
  deviceId: string;
  linked?: boolean;
}) {
  const { telemetry, loading, error, refreshData } = useSensorData(deviceId);
  return (
    <View style={{ gap: 16 }}>
      <Text style={ui.heading}>Growing conditions</Text>
      {!linked && (
        <Notice>
          Device {deviceId} is an unverified local mapping. Readings do not
          verify physical connection to this plant.
        </Notice>
      )}
      {loading && <Text style={ui.text}>Updating readings...</Text>}
      {error && (
        <Notice>{error.message} Previous readings may be stale.</Notice>
      )}
      {!telemetry && !loading && !error && (
        <Notice>No telemetry has been reported for this device.</Notice>
      )}
      {telemetry && (
        <>
          <Text style={ui.text}>
            Last sample: {new Date(telemetry.timestamp).toLocaleString()}
          </Text>
          <View style={ui.row}>
            <MetricCard
              title="Temperature"
              value={telemetry.environment.temperatureCelsius}
              unit="°C"
            />
            <MetricCard
              title="Humidity"
              value={telemetry.environment.humidityPercentage}
              unit="%"
            />
            <MetricCard
              title="Soil moisture"
              value={telemetry.soilMoisture.percentage}
              unit="%"
            />
            <MetricCard
              title="Light"
              value={telemetry.lightLevel.lux}
              unit="lux"
            />
          </View>
        </>
      )}
      <Action
        label="Refresh latest reading"
        disabled={loading}
        onPress={() => {
          void refreshData().catch(() => {});
        }}
      />
      <TelemetryHistory key={deviceId} deviceId={deviceId} />
    </View>
  );
}
