import type { CareTask } from "@/types";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Action, ui } from "./screen";

export function PlantCareTasksCard({ tasks, loading, error, onViewAll }: {
  tasks: readonly CareTask[]; loading: boolean; error: boolean; onViewAll: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return <View style={ui.card}>
    <Text accessibilityRole="header" style={ui.heading}>Care Tasks</Text>
    {tasks.length === 0 && <Text style={ui.text}>{loading ? "Loading care tasks…" : error ? "Care tasks are unavailable." : "No pending care tasks."}</Text>}
    {error && tasks.length > 0 && <Text style={ui.text}>Showing previously loaded tasks.</Text>}
    {tasks.slice(0, 3).map(task => <View key={task.id}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Details for ${task.title}`} accessibilityState={{ expanded: expandedId === task.id }} onPress={() => setExpandedId(value => value === task.id ? null : task.id)} style={{ minHeight: 44, gap: 4, paddingVertical: 8 }}>
        <Text numberOfLines={2} style={[ui.text, { fontWeight: "600", color: "#193E27" }]}>{task.title}</Text>
        <Text style={ui.text}>{Date.parse(task.dueDate) < Date.now() ? "Overdue · " : ""}{new Date(task.dueDate).toLocaleDateString()} · {task.urgency}</Text>
      </Pressable>
      {expandedId === task.id && <Text style={ui.text}>{task.description || "No additional details."}</Text>}
    </View>)}
    <Action label="View all tasks" variant="secondary" onPress={onViewAll} />
  </View>;
}
