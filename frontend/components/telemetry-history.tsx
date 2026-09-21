import { useTelemetryHistory } from "@/hooks/use-telemetry-history";
import {
    chronologicalReadings,
    metricSeries,
} from "@/services/telemetry-series";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Action, Notice, ui } from "./screen";

export const measurement = (value: number | null | undefined, unit: string) =>
  value == null ? "Not measured" : `${value} ${unit}`;
const metrics = [
  { key: "soilMoisture", title: "Moisture", unit: "%", max: 100 },
  { key: "temperature", title: "Temperature", unit: "°C", max: 40 },
  { key: "humidity", title: "Humidity", unit: "%", max: 100 },
  { key: "lightLevel", title: "Light", unit: "lux", max: 15000 },
] as const;

export function TelemetryHistory({ deviceId }: { deviceId: string }) {
  const [offset, setOffset] = useState(0);
  const limit = 200;
  const { readings, pagination, loading, error, refreshData } =
    useTelemetryHistory(deviceId, { limit, offset });
  const ordered = chronologicalReadings(readings);
  return (
    <View style={{ gap: 12 }}>
      <Text style={ui.heading}>Reading history</Text>
      <Text style={ui.text}>
        Oldest to newest • times shown in your local timezone
      </Text>
      {loading && <Notice>Loading readings...</Notice>}
      {error && (
        <Notice>{error.message} Existing readings may be stale.</Notice>
      )}
      <Action
        label="Refresh history"
        onPress={() => {
          void refreshData().catch(() => {});
        }}
        disabled={loading}
      />
      {!loading && !error && !ordered.length && (
        <Notice>No readings on this page.</Notice>
      )}
      {!!ordered.length &&
        metrics.map((metric) => {
          const points = metricSeries(ordered, metric.key);
          const values = points.flatMap((point) =>
            point.value == null ? [] : [point.value],
          );
          const scale = Math.max(metric.max, ...values);
          return (
            <View key={metric.key} style={ui.card}>
              <Text style={ui.heading}>{metric.title}</Text>
              <Text style={ui.text}>
                {values.length
                  ? `Range: ${Math.min(...values)}–${Math.max(...values)} ${metric.unit}`
                  : "Not measured"}
              </Text>
              <ScrollView
                horizontal
                accessibilityLabel={`${metric.title} time series, oldest to newest`}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-end",
                    height: 150,
                  }}
                >
                  {points.map((point) => (
                    <View
                      key={point.id}
                      accessible
                      accessibilityLabel={`${new Date(point.timestamp).toLocaleString()}: ${measurement(point.value, metric.unit)}`}
                      style={{
                        width: 12,
                        height: 150,
                        justifyContent: "flex-end",
                      }}
                    >
                      <View
                        style={{
                          width: 8,
                          height:
                            point.value == null
                              ? 0
                              : Math.max(2, (point.value / scale) * 145),
                          backgroundColor: "#278448",
                          borderRadius: 2,
                        }}
                      />
                    </View>
                  ))}
                </View>
              </ScrollView>
              <Text style={ui.text}>
                {new Date(ordered[0].timestamp).toLocaleString()} →{" "}
                {new Date(
                  ordered[ordered.length - 1].timestamp,
                ).toLocaleString()}
              </Text>
              <Text style={ui.text}>
                Latest:{" "}
                {measurement(points[points.length - 1].value, metric.unit)} •
                Swipe to inspect the full series.
              </Text>
            </View>
          );
        })}
      {pagination && (
        <Text style={ui.text}>
          {pagination.total} recorded readings • {ordered.length} shown
        </Text>
      )}
      <View style={ui.row}>
        <Action
          label="Newer readings"
          disabled={!offset || loading}
          onPress={() => setOffset((n) => Math.max(0, n - limit))}
        />
        <Action
          label="Older readings"
          disabled={!pagination?.hasMore || loading}
          onPress={() => setOffset((n) => n + limit)}
        />
      </View>
    </View>
  );
}
