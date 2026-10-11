import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { TaskSheet } from "./task-sheet";
import { careTaskPeriods, type CareTaskPeriod } from "@/services/care-task-filter";
export type TaskStatusFilter = "pending" | "completed" | "all";
export interface TaskFilters { status: TaskStatusFilter; period: CareTaskPeriod }
const statuses = ["pending", "completed", "all"] as const;
const statusLabel = (status: TaskStatusFilter) => status === "pending" ? "Pending" : status === "completed" ? "Completed" : "All";
const periodLabel = (period: CareTaskPeriod) => period === "This Week" ? "This week" : period === "Next Week" ? "Next week" : period;
export function TaskFilterBar({ value, onChange }: { value: TaskFilters; onChange: (value: TaskFilters) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`Filter care tasks: ${statusLabel(value.status)} · ${periodLabel(value.period)}`} accessibilityState={{ expanded: open }}
      style={s.trigger} onPress={() => { setDraft(value); setOpen(true); }}>
      <Ionicons name="options-outline" size={18} color="#17633A" /><Text style={s.triggerText}>{statusLabel(value.status)} · {periodLabel(value.period)}</Text><Ionicons name="chevron-down" size={16} color="#17633A" />
    </Pressable>
    {open && <TaskSheet title="Filter tasks" onClose={() => setOpen(false)}>
      <Text accessibilityRole="header" style={s.heading}>Status</Text>
      <View style={s.options}>{statuses.map(status => <Pressable key={status} accessibilityRole="radio" accessibilityLabel={`Show ${status} care tasks`} accessibilityState={{ checked: draft.status === status }}
        onPress={() => setDraft({ ...draft, status })} style={[s.option, draft.status === status && s.selected]}><Text style={s.label}>{statusLabel(status)}</Text></Pressable>)}</View>
      <Text accessibilityRole="header" style={s.heading}>{draft.status === "completed" ? "Completion date" : draft.status === "all" ? "Due / completion date" : "Due date"}</Text>
      <View style={s.options}>{careTaskPeriods.map(period => <Pressable key={period} accessibilityRole="radio" accessibilityLabel={`Show ${period} tasks`} accessibilityState={{ checked: draft.period === period }}
        onPress={() => setDraft({ ...draft, period })} style={[s.option, draft.period === period && s.selected]}><Text style={s.label}>{periodLabel(period)}</Text></Pressable>)}</View>
      {draft.period !== "All dates" && <Text style={s.note}>Undated checks are excluded.{draft.period === "This Week" && draft.status !== "completed" ? " This week also includes overdue tasks." : ""}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Apply task filters" onPress={() => { onChange(draft); setOpen(false); }} style={s.apply}><Text style={s.applyText}>Apply filters</Text></Pressable>
    </TaskSheet>}
  </>;
}
const s = StyleSheet.create({
  trigger: { minHeight: 48, flexDirection: "row", gap: 10, alignItems: "center", paddingHorizontal: 14, borderRadius: 14, backgroundColor: "#EDF5EF" },
  triggerText: { flex: 1, fontSize: 14, fontWeight: "600", color: "#17633A" }, heading: { fontSize: 15, fontWeight: "700", color: "#193E27" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, option: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "#DDE7DF" },
  selected: { backgroundColor: "#E5F3E9", borderColor: "#278448" }, label: { color: "#193E27", fontSize: 14 }, note: { color: "#506557", fontSize: 13, lineHeight: 20 },
  apply: { minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: "#17633A", borderRadius: 14 }, applyText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});
