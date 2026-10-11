import { StyleSheet, Text, View } from "react-native";
import type { TaskListItemProps } from "./TaskListItem";
import { careTaskDueLabel } from "@/services/care-tasks";
import { TaskSheet } from "./task-sheet";
import { AnimatedPressable as Pressable } from "./animated-pressable";
export function TaskDetailsSheet({ task, plant, now, disabled, onComplete, onClose, onOpenPlant, onSkip, onScan, error }: Omit<TaskListItemProps, "onDetails"> & {
  onClose: () => void; onOpenPlant: () => void; onSkip?: () => void; onScan?: () => void; error?: string | null;
}) {
  const completed = "completedAt" in task;
  return <TaskSheet title={task.title} onClose={onClose}>
    <Text style={s.meta}>{plant.name} · {careTaskDueLabel(task, now)}</Text>
    <Text style={s.source}>{task.serverId ? "From scan" : task.dueAt ? "Scheduled care" : "Manual check · no due date"}</Text>
    <Text accessibilityRole="header" style={s.heading}>Instructions</Text>
    <Text style={s.description}>{task.details.trim() || "No additional instructions."}</Text>
    {!!error && <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    <View style={s.links}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${plant.name} ${plant.id.startsWith("guest-") ? "space" : "plant profile"}`} onPress={onOpenPlant} style={s.link}><Text style={s.linkText}>Open plant</Text></Pressable>
      {onScan && !completed && <Pressable accessibilityRole="button" accessibilityLabel={`Scan ${plant.name}`} onPress={onScan} style={s.link}><Text style={s.linkText}>Scan this plant</Text></Pressable>}
      {onSkip && !completed && <Pressable accessibilityRole="button" accessibilityLabel={`Skip ${task.title} for ${plant.name}`} disabled={disabled} accessibilityState={{ disabled }} onPress={onSkip} style={[s.link, disabled && s.disabled]}><Text style={s.linkText}>Skip task</Text></Pressable>}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${completed ? "Undo" : "Complete"} ${task.title} for ${plant.name}`} accessibilityState={{ disabled }} disabled={disabled} onPress={onComplete} style={[s.primary, disabled && s.disabled]}><Text style={s.primaryText}>{completed ? "Undo completion" : "Mark as done"}</Text></Pressable>
  </TaskSheet>;
}
const s = StyleSheet.create({
  meta: { fontSize: 14, lineHeight: 21, color: "#506557" }, source: { fontSize: 12, color: "#506557" }, heading: { fontSize: 16, fontWeight: "700", color: "#193E27" },
  description: { fontSize: 15, lineHeight: 24, color: "#3F5547" }, links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }, linkText: { fontSize: 14, fontWeight: "600", color: "#17633A" },
  primary: { minHeight: 48, backgroundColor: "#17633A", borderRadius: 14, alignItems: "center", justifyContent: "center" }, primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.45 }, error: { color: "#895600", fontSize: 14, lineHeight: 21 },
});
