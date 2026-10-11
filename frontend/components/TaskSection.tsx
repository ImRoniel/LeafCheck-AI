import { useState, type PropsWithChildren } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "./animated-pressable";
export function TaskSection({ title, count, subtitle, defaultExpanded = true, children }: PropsWithChildren<{ title: string; count: number; subtitle?: string; defaultExpanded?: boolean }>) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!count) return null;
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${title}, ${count} tasks`} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={s.header}>
      <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={17} color="#506557" />
      <View style={s.labels}><Text style={s.title}>{title}</Text>{subtitle && <Text style={s.subtitle}>{subtitle}</Text>}</View>
      <Text style={s.count}>{count}</Text>
    </Pressable>
    {expanded && children}
  </View>;
}
const s = StyleSheet.create({
  header: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }, labels: { flex: 1, gap: 4 },
  title: { fontSize: 17, fontWeight: "700", color: "#193E27" }, subtitle: { fontSize: 12, lineHeight: 18, color: "#506557" }, count: { fontSize: 14, fontWeight: "600", color: "#506557" },
});
