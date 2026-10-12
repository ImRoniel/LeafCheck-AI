import { StyleSheet, Text, View } from "react-native";
import { TaskSheet } from "./task-sheet";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { sensorStatusLabel } from "@/services/dashboard-summary";
import { overviewReadingStatus } from "@/services/sensor-overview";
import { useSensorOverview } from "@/hooks/use-sensor-overview";
export function DashboardSensorStatusSheet({ onClose, onOpenPlant }: { onClose: () => void; onOpenPlant: (id: string) => void }) {
  const overview = useSensorOverview();
  const now = new Date();
  const refresh = () => { void overview.refresh().catch(() => undefined); };
  return <TaskSheet title="Sensor Overview" onClose={onClose}>
    {!overview.ready && !overview.error && <Text accessibilityLiveRegion="polite" style={s.meta}>Loading account sensors…</Text>}
    {overview.error && <Text accessibilityLiveRegion="polite" style={s.error}>Couldn’t refresh the sensor overview.{overview.ready ? " Showing saved readings." : ""}</Text>}
    {overview.entries.map(entry => {
      const status = overviewReadingStatus(entry, now, Boolean(overview.error));
      const reading = entry.telemetry;
      const soil = entry.demo && reading?.soilMoisture.percentage != null ? `${reading.soilMoisture.percentage}% (simulated)`
        : reading?.soilMoisture.rawAnalogValue != null ? `${reading.soilMoisture.rawAnalogValue} ADC` : "Unavailable";
      return <View key={entry.device.id} style={s.sensor}>
        <Text style={s.name}>{entry.device.name}</Text>
        <Text style={s.deviceId}>Device ID · {entry.device.macAddress}</Text>
        <Text style={[s.status, status === "error" && s.error]}>{status === "waiting" && !entry.plants.length ? "Waiting for first reading" : sensorStatusLabel(status)}</Text>
        <Text style={s.meta}>Linked plant · {entry.plants.map(plant => plant.name).join(", ") || "Not linked to a plant"}</Text>
        <Text style={s.meta}>{reading ? `Last received · ${new Date(reading.timestamp).toLocaleString()}` : status === "error" ? "Last reading unavailable" : "No readings received yet"}</Text>
        <Text style={s.caption}>Latest received readings{status === "stale" || status === "error" ? " · may be out of date" : ""}</Text>
        <View style={s.metrics}>
          <Text style={s.metric}>Temperature{`\n${reading ? `${reading.environment.temperatureCelsius} °C` : "Unavailable"}`}</Text>
          <Text style={s.metric}>Humidity{`\n${reading ? `${reading.environment.humidityPercentage}%` : "Unavailable"}`}</Text>
          <Text style={s.metric}>Soil moisture{`\n${soil}`}</Text>
        </View>
        {!entry.demo && reading?.soilMoisture.rawAnalogValue != null && <Text style={s.meta}>Raw soil reading · percentage requires calibration.</Text>}
        {entry.plants.map(plant => <Pressable key={plant.id} accessibilityRole="button" accessibilityLabel={`Open ${plant.name} growing conditions`} onPress={() => onOpenPlant(plant.id)} style={s.link}><Text style={s.linkText}>Open {plant.name} ›</Text></Pressable>)}
      </View>;
    })}
    {overview.ready && !overview.error && !overview.entries.length && <Text style={s.meta}>No sensors claimed for this account.</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Refresh sensor overview" accessibilityState={{ disabled: overview.loading }} disabled={overview.loading} onPress={refresh} style={[s.link, overview.loading && s.disabled]}><Text style={s.linkText}>{overview.loading ? "Refreshing…" : "Refresh readings"}</Text></Pressable>
  </TaskSheet>;
}
const s = StyleSheet.create({
  sensor: { borderBottomWidth: 1, borderBottomColor: "#D4E7D5", paddingBottom: 12, gap: 8 }, name: { color: "#1A4D2E", fontSize: 17, fontWeight: "700" },
  deviceId: { fontSize: 14, fontWeight: "600", color: "#1A4D2E" }, meta: { color: "#506557", fontSize: 13, lineHeight: 20 }, status: { color: "#278448", fontSize: 14, lineHeight: 21, fontWeight: "600" },
  caption: { color: "#506557", fontSize: 12 }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, metric: { flexGrow: 1, flexBasis: 110, backgroundColor: "#EDF5EF", borderRadius: 12, padding: 10, color: "#1A4D2E", fontSize: 13, lineHeight: 21 },
  link: { minHeight: 44, justifyContent: "center" }, linkText: { color: "#278448", fontSize: 14, fontWeight: "600" }, error: { color: "#A14E16", fontSize: 13, lineHeight: 20 }, disabled: { opacity: 0.5 },
});
