import { StyleSheet, Text, View } from "react-native";
export function TaskSummaryHeader({ dueToday, pending, ready }: { dueToday: number; pending: number; ready: boolean }) {
  return <View style={s.header}>
    <Text accessibilityRole="header" style={s.title}>Care Tasks</Text>
    <Text accessibilityLiveRegion="polite" style={s.summary}>{ready ? `${dueToday} due today · ${pending} pending` : "Loading task summary…"}</Text>
  </View>;
}
const s = StyleSheet.create({
  header: { gap: 6, paddingVertical: 4 }, title: { fontSize: 28, fontWeight: "800", color: "#193E27" },
  summary: { fontSize: 14, lineHeight: 21, color: "#506557" },
});
