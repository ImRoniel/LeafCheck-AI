import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { readingTimeLabel, sensorStatusLabel, type DashboardSensor, type DashboardSummary } from "@/services/dashboard-summary";
export function DashboardDailyDigest({ summary, sensors, ready, careReady, scansReady, guest, careError, scansError, now, onAttention, onTasks, onScans, onSensors, onRetry }: {
  summary: DashboardSummary; sensors: readonly DashboardSensor[]; ready: boolean; careReady: boolean; scansReady: boolean; guest: boolean;
  careError: boolean; scansError: boolean; now: Date; onAttention: () => void; onTasks: () => void; onScans: () => void; onSensors: () => void; onRetry: () => void;
}) {
  const row = (label: string, icon: "leaf-outline" | "calendar-outline" | "scan-outline", onPress: () => void) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.row}>
      <Ionicons name={icon} size={20} color="#1A4D2E" style={[s.rowIcon, icon === "leaf-outline" && s.warningIcon]} /><Text style={s.rowText}>{label}</Text><Ionicons name="chevron-forward" size={16} color="#278448" />
    </Pressable>;
  const receiving = sensors.filter(sensor => sensor.status === "receiving");
  const physical = sensors.filter(sensor => !sensor.demo);
  const newest = receiving.map(sensor => sensor.timestamp).filter((value): value is string => value !== null).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const sensorLabel = sensors.length === 1 ? `${sensorStatusLabel(sensors[0].status)}${!sensors[0].demo && sensors[0].address ? ` · ${sensors[0].address}` : ""}`
    : receiving.length ? `${receiving.length} of ${physical.length} sensors receiving readings`
    : physical.length ? `${physical.length} sensors · check reading status`
    : `${sensors.length} demo sensors · simulated readings`;
  return <View style={s.card}>
    <View style={s.heading}><Ionicons name="sunny-outline" size={21} color="#278448" /><Text accessibilityRole="header" style={s.title}>Daily Digest</Text></View>
    {!ready ? <Text accessibilityLiveRegion="polite" style={s.note}>Loading your garden…</Text> : <>
      {summary.attention.length > 0 && row(`${summary.attention.length} ${summary.attention.length === 1 ? "plant needs" : "plants need"} attention`, "leaf-outline", onAttention)}
      {careReady ? (summary.dueToday > 0 ? row(`${summary.dueToday}${summary.tasksLimited ? "+" : ""} care ${summary.dueToday === 1 && !summary.tasksLimited ? "task" : "tasks"} due today`, "calendar-outline", onTasks)
        : summary.overdue > 0 ? row(`${summary.overdue}${summary.tasksLimited ? "+" : ""} overdue care ${summary.overdue === 1 && !summary.tasksLimited ? "task" : "tasks"}`, "calendar-outline", onTasks)
        : summary.tasksLimited ? row("Review care tasks", "calendar-outline", onTasks)
        : <Text style={s.note}>{summary.attention.length ? "No scheduled care due today." : "No urgent care due."}</Text>)
        : row(careError ? "Care tasks unavailable · Retry" : "Checking care tasks…", "calendar-outline", onRetry)}
      {!guest && (scansReady ? row(`${summary.scannedToday}${summary.scansLimited ? "+" : ""} ${summary.scannedToday === 1 && !summary.scansLimited ? "plant" : "plants"} scanned today`, "scan-outline", onScans)
        : row(scansError ? "Scan activity unavailable · Retry" : "Checking scan activity…", "scan-outline", onRetry))}
    </>}
    {sensors.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="View sensor readings" onPress={onSensors} style={s.sensor}>
      <Ionicons name="radio-outline" size={18} color={receiving.length ? "#278448" : "#1A4D2E"} />
      <View style={s.sensorBody}><Text style={s.sensorText}>{sensorLabel}</Text>
        {(newest || (sensors.length === 1 && sensors[0].timestamp)) && <Text style={s.timestamp}>{readingTimeLabel(newest ?? sensors[0].timestamp, now)}</Text>}
        {physical.length > 0 && sensors.some(sensor => sensor.demo) && <Text style={s.timestamp}>Demo readings listed separately</Text>}
      </View><Ionicons name="chevron-forward" size={16} color="#278448" />
    </Pressable>}
  </View>;
}
const s = StyleSheet.create({
  card: { borderRadius: 24, backgroundColor: "#FFFFFF", padding: 16, gap: 4, borderWidth: 1, borderColor: "#D4E7D5", boxShadow: "0px 4px 16px rgba(26,77,46,0.08)" },
  heading: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 8 }, title: { color: "#278448", fontSize: 18, fontWeight: "800" },
  row: { flexDirection: "row", minHeight: 48, alignItems: "center", gap: 10, paddingVertical: 8 }, rowText: { flex: 1, color: "#1A4D2E", fontSize: 14, lineHeight: 21, fontWeight: "600" },
  rowIcon: { backgroundColor: "#E7F4E9", borderRadius: 12, padding: 5 }, warningIcon: { backgroundColor: "#FFF0D9", borderWidth: 1, borderColor: "#F2BD75" },
  note: { color: "#278448", fontSize: 14, lineHeight: 21, paddingVertical: 10 }, sensor: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: "#DCECDD", paddingTop: 12, marginTop: 8, paddingBottom: 4 },
  sensorBody: { flex: 1, gap: 3 }, sensorText: { fontSize: 13, lineHeight: 19, color: "#1A4D2E" }, timestamp: { fontSize: 12, lineHeight: 18, color: "#506557" },
});
