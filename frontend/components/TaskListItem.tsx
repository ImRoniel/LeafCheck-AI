import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import type { CareCompletion, GardenCareTask } from "@/types/care-task";
import type { Plant } from "@/types/plant";
import { careTaskDueLabel } from "@/services/care-tasks";
import { careTaskPreview } from "@/services/care-task-presentation";
import { CareTaskThumbnail } from "./care-task-thumbnail";
import { AnimatedPressable as Pressable } from "./animated-pressable";
export interface TaskListItemProps {
  task: GardenCareTask | CareCompletion; plant: Plant; now: Date; disabled: boolean;
  onDetails: () => void; onComplete: () => void;
}
export function TaskListItem({ task, plant, now, disabled, onDetails, onComplete }: TaskListItemProps) {
  const completed = "completedAt" in task;
  const overdue = !completed && !!task.dueAt && Date.parse(task.dueAt) < now.getTime();
  return <View style={s.row}>
    <View style={s.content}>
      <CareTaskThumbnail uri={plant.imageUrl} name={plant.name} compact />
      <View style={s.body}>
        <Text numberOfLines={2} style={[s.title, completed && s.completed]}>{task.title}</Text>
        <Text style={s.meta}>{plant.name} · <Text style={overdue && s.overdue}>{careTaskDueLabel(task, now)}</Text></Text>
        {!!task.details.trim() && <Text numberOfLines={2} ellipsizeMode="tail" style={s.description}>{careTaskPreview(task.details)}</Text>}
      </View>
    </View>
    <View style={s.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Show details for ${task.title} for ${plant.name}`} onPress={onDetails} style={s.details}><Text style={s.detailsText}>Details</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${completed ? "Undo" : "Complete"} ${task.title} for ${plant.name}`} accessibilityState={{ disabled }} disabled={disabled}
        onPress={onComplete} style={[s.done, disabled && s.disabled]}>
        {!completed && <Ionicons name="checkmark" size={17} color="#FFFFFF" />}<Text style={s.doneText}>{completed ? "Undo" : "Done"}</Text>
      </Pressable>
    </View>
  </View>;
}
const s = StyleSheet.create({
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#E7EEE8", gap: 8 },
  content: { flexDirection: "row", alignItems: "flex-start", gap: 12 }, body: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "700", color: "#193E27" }, completed: { color: "#506557" },
  meta: { fontSize: 12, lineHeight: 18, color: "#506557" }, overdue: { color: "#895600" }, description: { fontSize: 13, lineHeight: 20, color: "#506557" },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  details: { minHeight: 44, minWidth: 44, paddingHorizontal: 6, justifyContent: "center" }, detailsText: { fontSize: 14, fontWeight: "600", color: "#17633A" },
  done: { minHeight: 44, paddingHorizontal: 18, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#17633A" },
  doneText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" }, disabled: { opacity: 0.45 },
});
