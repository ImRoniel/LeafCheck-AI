import { Action, Notice, Screen } from "@/components/screen";
import { TaskSummaryHeader } from "@/components/TaskSummaryHeader";
import { TaskFilterBar, type TaskFilters } from "@/components/TaskFilterBar";
import { TaskListItem } from "@/components/TaskListItem";
import { TaskSection } from "@/components/TaskSection";
import { TaskDetailsSheet } from "@/components/TaskDetailsSheet";
import { AnimatedPressable as Pressable } from "@/components/animated-pressable";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import { useCareTasks } from "@/hooks/use-care-tasks";
import { buildCareTasks, completeCareTask, groupCareTasks, undoCareTask } from "@/services/care-tasks";
import type { CareCompletion, GardenCareTask } from "@/types/care-task";
import { filterCareTaskPeriod } from "@/services/care-task-filter";
import { tasksDueToday } from "@/services/care-task-presentation";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";

export default function CareTasks() {
  const data = useAppData();
  const local = useLocalState();
  const remote = useCareTasks(!data.guest);
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState<TaskFilters>({ status: "pending", period: "All dates" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAllManual, setShowAllManual] = useState(false);
  const [lastCompleted, setLastCompleted] = useState<GardenCareTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!lastCompleted) return;
    const timer = setTimeout(() => setLastCompleted(null), 6000);
    return () => clearTimeout(timer);
  }, [lastCompleted]);
  const lock = useRef(false);
  const screenEpoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useFocusEffect(useCallback(() => {
    const tick = () => { if (AppState.currentState === "active") setNow(new Date()); };
    tick();
    const timer = setInterval(tick, 60_000);
    const listener = AppState.addEventListener("change", state => {
      if (state !== "active") ++screenEpoch.current;
      tick();
    });
    return () => { ++screenEpoch.current; clearInterval(timer); listener.remove(); };
  }, []));
  const allGroups = groupCareTasks(buildCareTasks(data.plants, local.data.schedules, local.data.careCompletions, now,
    data.guest ? [] : remote.tasks), now);
  const groups = {
    overdue: filterCareTaskPeriod(allGroups.overdue, filters.period, now),
    today: filterCareTaskPeriod(allGroups.today, filters.period, now),
    upcoming: filterCareTaskPeriod(allGroups.upcoming, filters.period, now),
    attention: filterCareTaskPeriod(allGroups.manual.filter(task => task.priority === "immediate"), filters.period, now),
    manual: filterCareTaskPeriod(allGroups.manual.filter(task => task.priority === "routine"), filters.period, now),
    completed: filterCareTaskPeriod(allGroups.completed, filters.period, now),
  };
  const pendingCount = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.attention.length + groups.manual.length;
  const allPending = [...allGroups.overdue, ...allGroups.today, ...allGroups.manual, ...allGroups.upcoming];
  const dueToday = tasksDueToday(allPending, now);
  const countsReady = data.loaded && local.ready;
  const showPending = filters.status !== "completed";
  const showCompleted = filters.status !== "pending";
  const selectedTask = [...allPending, ...allGroups.completed].find(task => task.id === selectedId);
  const selectedPlant = data.plants.find(plant => plant.id === selectedTask?.plantId);
  const manualPlants = [...new Set(groups.manual.map(task => task.plantId))];
  const clearEmpty = countsReady && !data.loading && !remote.loading && !data.error && !(remote.error && !data.guest) && !local.error && !error;
  const disabled = saving || remote.saving || !local.ready;
  const refresh = () => {
    setNow(new Date());
    setError(null);
    void data.refresh();
    if (!data.guest) void remote.refresh().catch(() => undefined);
  };
  const change = async (task: GardenCareTask, action: "complete" | "undo" | "skip") => {
    if (lock.current || disabled || (action === "skip" && !task.serverId)) return;
    const epoch = screenEpoch.current;
    // The account hook owns its cancellable mutation lock; a blurred request must
    // not leave the screen locked if its transport never settles.
    if (!task.serverId) { lock.current = true; setSaving(true); }
    setError(null);
    try {
      if (task.serverId) {
        if (data.guest) return;
        if (action === "skip") await remote.skip(task.serverId);
        else await remote.update(task.serverId, action === "complete");
      } else await local.update(state => action === "undo" ? undoCareTask(state, task.id) : completeCareTask(state, task));
      if (mounted.current && screenEpoch.current === epoch) {
        setNow(new Date());
        setSelectedId(null);
        setLastCompleted(action === "complete" ? task : null);
      }
    } catch {
      if (mounted.current && screenEpoch.current === epoch) setError(task.serverId
        ? "Could not confirm the account update. Refresh tasks before retrying."
        : "Could not save your change. The checklist is unchanged. Try again.");
    } finally {
      if (!task.serverId) {
        lock.current = false;
        if (mounted.current) setSaving(false);
      }
    }
  };
  const openPlant = (plantId: string) => {
    const plant = data.plants.find(item => item.id === plantId);
    if (!plant) return;
    setSelectedId(null);
    router.push(data.guest
      ? { pathname: "/(tabs)/space-detail", params: { space: plant.location?.trim() || "Unassigned" } }
      : { pathname: "/plant-profile", params: { id: plant.id } });
  };
  const item = (task: GardenCareTask | CareCompletion) => {
    const plant = data.plants.find(plant => plant.id === task.plantId);
    return plant ? <TaskListItem key={task.id} task={task} plant={plant} now={now} disabled={disabled}
      onDetails={() => { setError(null); setSelectedId(task.id); }}
      onComplete={() => void change(task, "completedAt" in task ? "undo" : "complete")} /> : null;
  };
  const section = (title: string, tasks: readonly (GardenCareTask | CareCompletion)[], defaultExpanded = true) =>
    <TaskSection key={`${filters.status}:${filters.period}:${title}`} title={title} count={tasks.length} defaultExpanded={defaultExpanded}>{tasks.map(item)}</TaskSection>;
  const visibleCount = (showPending ? pendingCount : 0) + (showCompleted ? groups.completed.length : 0);
  return <View style={s.page}>
    <Screen fill backgroundColor="#FFFFFF" refresh={refresh} loading={data.loading || remote.loading || (!local.ready && !local.error)}>
    <TaskSummaryHeader pending={allPending.length} dueToday={dueToday.length} ready={countsReady} />
    <TaskFilterBar value={filters} onChange={value => { setFilters(value); setShowAllManual(false); }} />
    {filters.period !== "All dates" && showPending && <Text style={s.source}>Undated checks are excluded from this view.</Text>}
    {(data.loading || remote.loading || (!local.ready && !local.error)) && <View style={s.loading}><ActivityIndicator size="small" color="#278448" /><Text style={s.details}>{countsReady ? "Refreshing tasks…" : "Loading care tasks…"}</Text></View>}
    {!!data.error && <><Notice>{data.error}{data.loaded ? " Showing saved plants." : ""}</Notice><Action label="Retry loading plants" onPress={() => void data.refresh()} /></>}
    {!!remote.error && !data.guest && <><Notice>Scan tasks could not refresh. Saved tasks may be out of date; local checks are available.</Notice><Action label="Retry scan tasks" onPress={() => void remote.refresh().catch(() => undefined)} /></>}
    {!!local.error && <><Notice>Local care could not load. Your saved data has not been replaced.</Notice><Action label="Retry local care" onPress={() => void local.retry()} /></>}
    {!!error && <><Notice>{error}</Notice><Action label="Refresh care tasks" onPress={refresh} /></>}
    {disabled && (saving || remote.saving) && <Text accessibilityLiveRegion="polite" style={s.source}>Saving task…</Text>}
    {lastCompleted && <View style={s.feedback}><Text accessibilityLiveRegion="polite" style={s.feedbackText}>Task completed</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Undo last completion of ${lastCompleted.title}`} disabled={disabled} accessibilityState={{ disabled }} onPress={() => void change(lastCompleted, "undo")} style={s.textButton}><Text style={s.link}>Undo</Text></Pressable>
    </View>}
    {countsReady && <>
      {showPending && <>
        {section("Overdue", groups.overdue)}
        {section("Due today", groups.today)}
        {section("Needs attention", groups.attention)}
        {section("Upcoming", groups.upcoming, false)}
        <TaskSection key={`${filters.status}:${filters.period}:manual`} title="Manual checks" count={groups.manual.length} defaultExpanded={false}
          subtitle={`Routine checks · no due date · ${manualPlants.length} ${manualPlants.length === 1 ? "plant" : "plants"}`}>
          {(showAllManual ? manualPlants : manualPlants.slice(0, 3)).map(plantId => <View key={plantId}>
            <Text accessibilityRole="header" style={s.plantHeading}>{data.plants.find(plant => plant.id === plantId)?.name}</Text>
            {groups.manual.filter(task => task.plantId === plantId).map(item)}
          </View>)}
          {!showAllManual && manualPlants.length > 3 && <Pressable accessibilityRole="button" accessibilityLabel="Show all manual checks" style={s.textButton} onPress={() => setShowAllManual(true)}><Text style={s.link}>Show all checks ({groups.manual.length})</Text></Pressable>}
        </TaskSection>
      </>}
      {showCompleted && section("Completed", groups.completed)}
      {clearEmpty && !visibleCount && <View style={s.empty}>
        <Ionicons name="leaf-outline" size={32} color="#299B57" />
        <Text style={s.emptyTitle}>{filters.period !== "All dates" ? "No tasks in this view" : filters.status === "completed" ? "No completed tasks yet" : "All caught up"}</Text>
        <Text style={s.emptyText}>{filters.period !== "All dates" ? "Try All dates to see your other care tasks." : filters.status === "completed" ? "Completed care will appear here." : "No pending tasks."}</Text>
      </View>}
    </>}
  </Screen>
  {!!selectedTask && !!selectedPlant && <TaskDetailsSheet task={selectedTask} plant={selectedPlant} now={now} disabled={disabled} error={error}
    onClose={() => setSelectedId(null)} onOpenPlant={() => openPlant(selectedPlant.id)}
    onComplete={() => void change(selectedTask, "completedAt" in selectedTask ? "undo" : "complete")}
    onSkip={selectedTask.serverId && !data.guest && !("completedAt" in selectedTask) ? () => void change(selectedTask, "skip") : undefined}
    onScan={!data.guest && selectedTask.title === "Scan actual plant image" ? () => {
      setSelectedId(null);
      router.push({ pathname: "/(tabs)/scanner", params: { plantId: selectedPlant.id, ...(selectedPlant.deviceId ? { deviceId: selectedPlant.deviceId } : {}) } });
    } : undefined} />}
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1, minHeight: 0, backgroundColor: "#FFFFFF" },
  source: { fontSize: 12, lineHeight: 18, color: "#506557" },
  loading: { flexDirection: "row", alignItems: "center", gap: 8 }, details: { color: "#506557", fontSize: 13, lineHeight: 20 },
  feedback: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#EDF5EF", paddingHorizontal: 12, borderRadius: 12 },
  feedbackText: { fontSize: 14, color: "#193E27" }, textButton: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 4 },
  link: { fontSize: 14, fontWeight: "600", color: "#17633A" }, plantHeading: { fontSize: 14, fontWeight: "600", color: "#506557", paddingTop: 12 },
  empty: { flex: 1, minHeight: 180, justifyContent: "center", paddingVertical: 24, gap: 10, alignItems: "center" },
  emptyTitle: { color: "#193E27", fontSize: 19, fontWeight: "700", textAlign: "center" }, emptyText: { color: "#506557", fontSize: 13, lineHeight: 20, textAlign: "center" },
});
