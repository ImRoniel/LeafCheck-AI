import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { TaskSheet } from "./task-sheet";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { sensorStatusLabel } from "@/services/dashboard-summary";
import { groupSensorOverview, overviewReadingStatus } from "@/services/sensor-overview";
import { useSensorOverview } from "@/hooks/use-sensor-overview";
import type { SensorOverviewEntry } from "@/types/device";

function SensorReading({ entry, now, listError }: { entry: SensorOverviewEntry; now: Date; listError: boolean }) {
  const status = overviewReadingStatus(entry, now, listError);
  const reading = entry.telemetry;
  const soil = entry.demo && reading?.soilMoisture.percentage != null ? `${reading.soilMoisture.percentage}% (simulated)`
    : reading?.soilMoisture.rawAnalogValue != null ? `${reading.soilMoisture.rawAnalogValue} ADC` : "Unavailable";
  return <View style={s.sensor}>
    <Text style={s.deviceName}>{entry.device.name}</Text>
    <Text style={s.deviceId}>Device ID · {entry.device.macAddress}</Text>
    <Text style={[s.status, ["error", "stale", "waiting"].includes(status) && s.warningText]}>{status === "waiting" && !entry.plants.length ? "Waiting for first reading" : sensorStatusLabel(status)}</Text>
    <Text style={s.meta}>{reading ? `Last received · ${new Date(reading.timestamp).toLocaleString()}` : status === "error" ? "Last reading unavailable" : "No readings received yet"}</Text>
    <Text style={s.caption}>Latest received readings{status === "stale" || status === "error" ? " · may be out of date" : ""}</Text>
    <View style={s.metrics}>
      <Text style={s.metric}>Temperature{`\n${reading ? `${reading.environment.temperatureCelsius} °C` : "Unavailable"}`}</Text>
      <Text style={s.metric}>Humidity{`\n${reading ? `${reading.environment.humidityPercentage}%` : "Unavailable"}`}</Text>
      <Text style={s.metric}>Soil moisture{`\n${soil}`}</Text>
    </View>
    {!entry.demo && reading?.soilMoisture.rawAnalogValue != null && <Text style={s.meta}>Raw soil reading · percentage requires calibration.</Text>}
  </View>;
}

export function DashboardSensorStatusSheet({ onClose, onOpenPlant, onManageDevices }: { onClose: () => void; onOpenPlant: (id: string) => void; onManageDevices: () => void }) {
  const overview = useSensorOverview();
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const now = new Date();
  const groups = groupSensorOverview(overview.entries, query, now, Boolean(overview.error));
  const attentionCount = overview.entries.filter(entry => ["error", "stale", "waiting"].includes(overviewReadingStatus(entry, now, Boolean(overview.error)))).length;
  const refresh = () => { void overview.refresh().catch(() => undefined); };
  const searchVisible = overview.entries.length > 3 || query.length > 0;
  return <TaskSheet title="Sensor Overview" onClose={onClose}
    headerContent={<View style={s.controls}>
      {overview.ready && <Text accessibilityLiveRegion="polite" style={s.meta}>{overview.entries.length} {overview.entries.length === 1 ? "device" : "devices"}{attentionCount > 0 ? ` · ${attentionCount} ${attentionCount === 1 ? "needs" : "need"} attention` : ""}</Text>}
      {searchVisible && <View style={s.search}>
        <Ionicons name="search-outline" size={19} color="#278448" />
        <TextInput accessibilityLabel="Search sensors by device ID or plant name" placeholder="Device ID or plant name" placeholderTextColor="#506557"
          value={query} onChangeText={value => { setQuery(value); setExpandedGroups({}); }} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={s.input} />
        {query.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear sensor search" onPress={() => { setQuery(""); setExpandedGroups({}); }} style={s.clear}><Ionicons name="close-circle" size={20} color="#506557" /></Pressable>}
      </View>}
    </View>}
    footer={<View style={s.footer}>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh sensor overview" accessibilityState={{ disabled: overview.loading }} disabled={overview.loading} onPress={refresh} style={[s.link, overview.loading && s.disabled]}><Text style={s.linkText}>{overview.loading ? "Refreshing…" : "Refresh readings"}</Text></Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel="Manage all devices" onPress={onManageDevices} style={s.link}><Text style={s.linkText}>Manage all devices →</Text></Pressable>
    </View>}>
    {!overview.ready && !overview.error && <Text accessibilityLiveRegion="polite" style={s.meta}>Loading account sensors…</Text>}
    {overview.error && <Text accessibilityLiveRegion="polite" style={s.error}>{overview.errorMessage ?? "Couldn’t refresh the sensor overview."}{overview.ready ? " Showing saved readings." : ""}</Text>}
    {groups.map(group => {
      const expanded = expandedGroups[group.key] ?? (Boolean(query.trim()) || overview.entries.length <= 3 || group.attentionCount > 0);
      return <View key={group.key} style={s.group}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${group.title}, ${group.entries.length} ${group.entries.length === 1 ? "sensor" : "sensors"}`}
          accessibilityState={{ expanded }} onPress={() => setExpandedGroups(current => ({ ...current, [group.key]: !expanded }))} style={s.groupHeader}>
          <Ionicons name="leaf-outline" size={20} color="#278448" />
          <View style={s.groupTitle}>
            <Text accessibilityRole="header" style={s.name}>{group.title}</Text>
            <Text style={s.meta}>{group.entries.length} {group.entries.length === 1 ? "sensor" : "sensors"}{group.attentionCount > 0 ? ` · ${group.attentionCount} ${group.attentionCount === 1 ? "needs" : "need"} attention` : ""}</Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#278448" />
        </Pressable>
        <View style={[s.badge, group.attentionCount > 0 && s.warningBadge]}><Text style={[s.badgeText, group.attentionCount > 0 && s.warningText]}>{sensorStatusLabel(group.status)}</Text></View>
        {expanded && <View style={s.groupContent}>
          {group.entries.map(entry => <SensorReading key={entry.device.id} entry={entry} now={now} listError={Boolean(overview.error)} />)}
          {group.plants.map(plant => <Pressable key={plant.id} accessibilityRole="button" accessibilityLabel={`Open ${plant.name} growing conditions`} onPress={() => onOpenPlant(plant.id)} style={s.link}><Text style={s.linkText}>Open {plant.name} ›</Text></Pressable>)}
        </View>}
      </View>;
    })}
    {overview.ready && query.trim() && !groups.length && <Text accessibilityLiveRegion="polite" style={s.meta}>No sensors match “{query.trim()}”. Try a device ID or plant name.</Text>}
    {overview.ready && !overview.error && !overview.entries.length && <Text style={s.meta}>No sensors claimed for this account.</Text>}
  </TaskSheet>;
}
const s = StyleSheet.create({
  controls: { gap: 10, paddingBottom: 14 }, search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#D4E7D5", backgroundColor: "#F4F9F4", borderRadius: 14, paddingLeft: 12 },
  input: { flex: 1, minWidth: 0, minHeight: 46, color: "#1A4D2E", fontSize: 14 }, clear: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  group: { borderWidth: 1, borderColor: "#D4E7D5", backgroundColor: "#FFFFFF", borderRadius: 18, padding: 14, gap: 10 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }, groupTitle: { flex: 1, gap: 2 }, groupContent: { gap: 14 },
  badge: { alignSelf: "flex-start", backgroundColor: "#EDF5EF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 }, badgeText: { fontSize: 12, fontWeight: "600", color: "#278448" },
  warningBadge: { backgroundColor: "#FFF1DE" }, warningText: { color: "#A14E16" }, footer: { borderTopWidth: 1, borderTopColor: "#D4E7D5", paddingTop: 6, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
  sensor: { borderTopWidth: 1, borderTopColor: "#D4E7D5", paddingTop: 12, gap: 8 }, name: { color: "#1A4D2E", fontSize: 17, fontWeight: "700" }, deviceName: { color: "#1A4D2E", fontSize: 15, fontWeight: "600" },
  deviceId: { fontSize: 14, fontWeight: "600", color: "#1A4D2E" }, meta: { color: "#506557", fontSize: 13, lineHeight: 20 }, status: { color: "#278448", fontSize: 14, lineHeight: 21, fontWeight: "600" },
  caption: { color: "#506557", fontSize: 12 }, metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, metric: { flexGrow: 1, flexBasis: 80, backgroundColor: "#EDF5EF", borderRadius: 12, padding: 10, color: "#1A4D2E", fontSize: 12, lineHeight: 20 },
  link: { minHeight: 44, justifyContent: "center" }, linkText: { color: "#278448", fontSize: 14, fontWeight: "600" }, error: { color: "#A14E16", fontSize: 13, lineHeight: 20 }, disabled: { opacity: 0.5 },
});
