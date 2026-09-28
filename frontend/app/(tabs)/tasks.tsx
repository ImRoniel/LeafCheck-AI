import { CollectionState } from "@/components/plant-list";
import { Action, Notice, Screen, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import { useCareTasks } from "@/hooks/use-care-tasks";
import {
  buildCareTasks,
  completeCareTask,
  undoCareTask,
} from "@/services/care-tasks";
import type { CareCompletion, GardenCareTask } from "@/types/care-task";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";

export default function CareTasks() {
  const data = useAppData();
  const local = useLocalState();
  const remote = useCareTasks(!data.guest);
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const tick = () => {
        if (AppState.currentState === "active") setNow(new Date());
      };
      tick();
      const timer = setInterval(tick, 60_000);
      const listener = AppState.addEventListener("change", tick);
      return () => {
        clearInterval(timer);
        listener.remove();
      };
    }, []),
  );
  const groups = buildCareTasks(
    data.plants,
    local.data.schedules,
    local.data.careCompletions,
    now,
    remote.tasks,
  );

  const toggle = async (task: GardenCareTask, completed: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      if (task.serverId) await remote.update(task.serverId, !completed);
      else
        await local.update((state) =>
          completed
            ? undoCareTask(state, task.id)
            : completeCareTask(state, task),
        );
      setNow(new Date());
    } catch {
      setError(
        task.serverId
          ? "Could not confirm the server update. Refresh care tasks before retrying."
          : "Your change could not be saved. The checklist is unchanged. Try again.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  const section = (
    title: string,
    tasks: readonly (GardenCareTask | CareCompletion)[],
    empty: string,
    completed = false,
  ) => (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={ui.heading}>
        {title} · {tasks.length}
      </Text>
      {!tasks.length && <Text style={ui.text}>{empty}</Text>}
      {tasks.map((task) => {
        const plant = data.plants.find((plant) => plant.id === task.plantId);
        if (!plant) return null;
        return (
          <View
            key={task.id}
            style={[
              ui.card,
              { flexDirection: "row", alignItems: "flex-start" },
            ]}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`${completed ? "Undo" : "Complete"} ${task.title} for ${plant.name}`}
              accessibilityState={{ checked: completed, disabled: saving }}
              disabled={saving}
              onPress={() => void toggle(task, completed)}
              style={{
                minWidth: 48,
                minHeight: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name={completed ? "checkbox" : "square-outline"}
                size={28}
                color="#1B6B36"
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${task.title}. Open ${plant.name}${data.guest ? " space" : " details"}`}
              style={{ flex: 1, minHeight: 48, gap: 6 }}
              onPress={() =>
                data.guest
                  ? router.push({
                      pathname: "/(tabs)/space-detail",
                      params: { space: plant.location?.trim() || "Unassigned" },
                    })
                  : router.push({
                      pathname: "/plant-profile",
                      params: { id: plant.id },
                    })
              }
            >
              <Text style={ui.heading}>{task.title}</Text>
              <Text style={ui.text}>
                {plant.name} · {plant.location || "Unassigned"}
              </Text>
              <Text style={ui.text}>{task.details}</Text>
              <Text style={ui.text}>
                {task.serverId
                  ? "Scan task · synced to your account"
                  : "Local care checklist · this device"}
              </Text>
              <Text style={ui.text}>
                {"completedAt" in task
                  ? `Completed ${new Date(task.completedAt).toLocaleString()}`
                  : task.dueAt
                    ? `Due ${new Date(task.dueAt).toLocaleString()}`
                    : task.priority === "immediate"
                      ? "Needs attention"
                      : "Unscheduled manual check"}
              </Text>
              <Text style={{ color: "#1B6B36", fontWeight: "700" }}>
                {data.guest ? "Open space" : "Open plant"} →
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );

  return (
    <Screen
      title="Care Tasks"
      refresh={() => {
        setNow(new Date());
        void data.refresh();
        if (!data.guest) void remote.refresh().catch(() => undefined);
      }}
      loading={data.loading || remote.loading}
    >
      <Text style={ui.text}>
        Saved recommendations and your local care preferences. Check off actions
        after performing them; this does not change plant health or confirm
        sensor readings.
      </Text>
      <Text style={ui.text}>
        Scan task completions sync to your account. Local checklist completions
        stay on this device. Scheduled checks start one interval after the plan
        was saved and repeat after completion.
      </Text>
      <CollectionState />
      {remote.loading && <Notice>Loading scan care tasks…</Notice>}
      {remote.error && (
        <>
          <Notice>
            Scan care tasks could not be refreshed. Local checks remain
            available; any previously loaded scan tasks may be outdated.
          </Notice>
          <Action
            label="Retry scan care tasks"
            onPress={() => void remote.refresh().catch(() => undefined)}
          />
        </>
      )}
      {error && <Notice>{error}</Notice>}
      {saving && <Notice>Saving checklist…</Notice>}
      {data.loaded && (
        <>
          {section(
            "Today / Immediate",
            groups.today,
            "No immediate care tasks.",
          )}
          {section(
            "Upcoming / Routine",
            groups.upcoming,
            "No upcoming care tasks.",
          )}
          {section(
            "Completed",
            groups.completed,
            "Completed actions will appear here. Tap a checked box to undo.",
            true,
          )}
        </>
      )}
      <Action
        label="Open My Garden"
        onPress={() => router.navigate("/(tabs)/garden")}
      />
    </Screen>
  );
}
