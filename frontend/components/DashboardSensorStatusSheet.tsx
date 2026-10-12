import { StyleSheet, Text, View } from "react-native";
import { TaskSheet } from "./task-sheet";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { sensorStatusLabel, type DashboardSensor } from "@/services/dashboard-summary";
export function DashboardSensorStatusSheet({ sensors, onClose, onOpenPlant, onRetry }: { sensors: readonly DashboardSensor[]; onClose: () => void; onOpenPlant: (id: string) => void; onRetry: () => void }) {
  return <TaskSheet title="Sensor readings" onClose={onClose}>
    {sensors.map(sensor => <View key={sensor.plant.id} style={s.sensor}>
      <Text style={s.name}>{sensor.plant.name}</Text>
      <Text style={s.meta}>{sensor.name}{sensor.address ? ` · ${sensor.address}` : ""}</Text>
      <Text style={s.status}>{sensorStatusLabel(sensor.status)}</Text>
      {sensor.timestamp && Number.isFinite(Date.parse(sensor.timestamp)) && <Text style={s.meta}>Last reading · {new Date(sensor.timestamp).toLocaleString()}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${sensor.plant.name} growing conditions`} onPress={() => onOpenPlant(sensor.plant.id)} style={s.link}><Text style={s.linkText}>Open plant ›</Text></Pressable>
    </View>)}
    {!sensors.length && <Text style={s.meta}>No linked sensors in this garden.</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Refresh dashboard sensor readings" onPress={onRetry} style={s.link}><Text style={s.linkText}>Refresh readings</Text></Pressable>
  </TaskSheet>;
}
const s = StyleSheet.create({
  sensor: { borderBottomWidth: 1, borderBottomColor: "#E1EAE2", paddingBottom: 8, gap: 6 }, name: { color: "#193E27", fontSize: 16, fontWeight: "700" },
  meta: { color: "#506557", fontSize: 13, lineHeight: 20 }, status: { color: "#193E27", fontSize: 14, lineHeight: 21 },
  link: { minHeight: 44, justifyContent: "center" }, linkText: { color: "#17633A", fontSize: 14, fontWeight: "600" },
});
