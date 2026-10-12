import { StyleSheet, Text, View } from "react-native";
import { BrandScreenHeader } from "./BrandScreenHeader";
export function TaskSummaryHeader({ dueToday, pending, ready }: { dueToday: number; pending: number; ready: boolean }) {
  return <View style={s.header}>
    <BrandScreenHeader first="Care" second="Tasks" subtitle="Keep your plants healthy and happy" />
    <Text accessibilityLiveRegion="polite" style={s.summary}>{ready ? `${dueToday} due today · ${pending} pending` : "Loading task summary…"}</Text>
  </View>;
}
const s = StyleSheet.create({
  header: { gap: 6 },
  summary: { fontSize: 14, lineHeight: 21, color: "#506557" },
});
