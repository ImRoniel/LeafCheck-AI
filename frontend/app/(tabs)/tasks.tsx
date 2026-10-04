import { Action, Notice, Screen } from "@/components/screen";
import { CareTaskThumbnail } from "@/components/care-task-thumbnail";
import { AnimatedPressable as Pressable } from "@/components/animated-pressable";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import { useCareTasks } from "@/hooks/use-care-tasks";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { buildCareTasks, careTaskDueLabel, completeCareTask, groupCareTasks, undoCareTask } from "@/services/care-tasks";
import type { CareCompletion, GardenCareTask } from "@/types/care-task";
import { careTaskPeriods, filterCareTaskPeriod, type CareTaskPeriod } from "@/services/care-task-filter";
import { careTaskPreview, tasksDueToday } from "@/services/care-task-presentation";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, LayoutAnimation, Platform, UIManager, StyleSheet, Text, View, useWindowDimensions } from "react-native";

export default function CareTasks() {
  const data = useAppData();
  const local = useLocalState();
  const remote = useCareTasks(!data.guest);
  const router = useRouter();
  const compact = useWindowDimensions().width < 360;
  const reducedMotion = useReducedMotion();
  const [now, setNow] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"all" | "pending" | "completed" | "today">("all");
  const [period, setPeriod] = useState<CareTaskPeriod>("This Week");
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => { if (Platform.OS === "android") UIManager.setLayoutAnimationEnabledExperimental?.(true); }, []);
  const animateFilter = () => { if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); };
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    overdue: filterCareTaskPeriod(allGroups.overdue, period, now),
    today: filterCareTaskPeriod(allGroups.today, period, now),
    upcoming: filterCareTaskPeriod(allGroups.upcoming, period, now),
    manual: filterCareTaskPeriod(allGroups.manual, period, now),
    completed: filterCareTaskPeriod(allGroups.completed, period, now),
  };
  const pendingCount = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.manual.length;
  const allPending = [...allGroups.overdue, ...allGroups.today, ...allGroups.manual, ...allGroups.upcoming];
  const dueToday = tasksDueToday(allPending, now);
  const countsReady = data.loaded && local.ready;
  const showPending = view === "all" || view === "pending";
  const showCompleted = view === "all" || view === "completed";
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
      if (mounted.current && screenEpoch.current === epoch) setNow(new Date());
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
  const section = (title: string, tasks: readonly (GardenCareTask | CareCompletion)[], completed = false) => tasks.length > 0 && (
    <View style={s.section} key={title}>
      <View style={s.sectionHeader}><Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text><Text style={s.count}>{tasks.length}</Text></View>
      {tasks.map(task => {
        const plant = data.plants.find(plant => plant.id === task.plantId);
        if (!plant) return null;
        const overdue = !completed && !!task.dueAt && Date.parse(task.dueAt) < now.getTime();
        const attention = !completed && task.priority === "immediate";
        const details = task.details.trim();
        const isExpanded = expanded === task.id;
        const preview = careTaskPreview(details);
        return <View key={task.id} style={s.card}>
          <CareTaskThumbnail uri={plant.imageUrl} name={plant.name} />
          <View style={s.cardBody}>
          <View style={s.taskRow}>
            <View style={s.taskContent}>
              <Text style={[s.taskTitle, completed && s.completedTitle]}>{task.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${plant.name}${data.guest ? " space" : " plant profile"}`}
                style={s.plantLink} onPress={() => data.guest
                  ? router.push({ pathname: "/(tabs)/space-detail", params: { space: plant.location?.trim() || "Unassigned" } })
                  : router.push({ pathname: "/plant-profile", params: { id: plant.id } })}>
                <Ionicons name="leaf-outline" size={14} color="#506557" /><Text style={s.plantName}>{plant.name}</Text>
                <Ionicons name="chevron-forward" size={13} color="#506557" />
              </Pressable>
            </View>
            <Pressable accessibilityRole="button"
              accessibilityLabel={`${completed ? "Undo" : "Complete"} ${task.title} for ${plant.name}`}
              accessibilityState={{ disabled }} disabled={disabled}
              style={[s.actionControl, disabled && s.disabled]}
              onPress={() => void change(task, completed ? "undo" : "complete")}>
              <Text style={s.actionLabel}>{completed ? "Undo" : "Mark as done"}</Text>
            </Pressable>
          </View>
          <View style={s.meta}>
            <Ionicons name={completed ? "checkmark-circle-outline" : overdue ? "time-outline" : "calendar-outline"} size={15} color={overdue ? "#8A651E" : "#506557"} />
            <Text style={[s.due, overdue && s.overdue]}>{careTaskDueLabel(task, now)}</Text>
            {attention && <Text style={s.attention}>Needs attention</Text>}
          </View>
          {!!details && <Text style={s.details}>{isExpanded ? details : preview}</Text>}
          <View style={s.footer}>
            <Text style={s.source} accessibilityLabel={task.serverId ? "Scan task synced to your account" : "Care checklist saved on this device"}>{task.serverId ? "Scan task" : task.dueAt ? "Scheduled care" : "Manual check"}</Text>
            {preview !== details && <Pressable accessibilityRole="button" accessibilityLabel={`${isExpanded ? "Hide" : "Show"} details for ${task.title}`}
              accessibilityState={{ expanded: isExpanded }} style={s.textButton} onPress={() => setExpanded(isExpanded ? null : task.id)}><Text style={s.link}>{isExpanded ? "Less" : "Details"}</Text></Pressable>}
            {!completed && !!task.serverId && !data.guest && <Pressable accessibilityRole="button" accessibilityLabel={`Skip ${task.title} for ${plant.name}`}
              accessibilityState={{ disabled }} disabled={disabled} style={[s.textButton, disabled && s.disabled]} onPress={() => void change(task, "skip")}><Text style={s.link}>Skip</Text></Pressable>}
          </View>
          </View>
        </View>;
      })}
    </View>
  );
  return <View style={s.page}>
    <Screen fill backgroundColor="#FFFFFF" refresh={refresh} loading={data.loading || remote.loading || (!local.ready && !local.error)}>
    <View style={s.header}>
      <Text accessibilityRole="header" accessibilityLabel="Care Tasks" style={s.title}>Care <Text style={s.titleAccent}>Tasks</Text></Text>
      <Text style={s.subtitle}>Keep your plants healthy and happy</Text>
    </View>
    <View style={s.summaries}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Show pending tasks: ${countsReady ? allPending.length : "loading"}`} accessibilityHint="Count includes all loaded pending tasks. The week filter controls the list." accessibilityState={{ selected: view === "pending" }} style={[s.summary, s.pendingSummary, compact && s.compactSummary, view === "pending" && s.selectedSummary]} onPress={() => setView("pending")}>
        <Ionicons name="clipboard-outline" size={24} color="#17633A" />
        <View style={[s.summaryContent, compact && s.centerSummary]}><Text accessibilityLiveRegion="polite" style={s.summaryNumber}>{countsReady ? allPending.length : "—"}</Text><Text style={s.summaryLabel}>To do</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Show completed tasks: ${countsReady ? allGroups.completed.length : "loading"}`} accessibilityHint="Count includes all loaded completed tasks. The week filter controls the list." accessibilityState={{ selected: view === "completed" }} style={[s.summary, s.completedSummary, compact && s.compactSummary, view === "completed" && s.selectedSummary]} onPress={() => setView("completed")}>
        <Ionicons name="checkmark-circle" size={24} color="#299B57" />
        <View style={[s.summaryContent, compact && s.centerSummary]}><Text accessibilityLiveRegion="polite" style={s.summaryNumber}>{countsReady ? allGroups.completed.length : "—"}</Text><Text style={s.summaryLabel}>Completed</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Show tasks due today: ${countsReady ? dueToday.length : "loading"}`} accessibilityState={{ selected: view === "today" }} style={[s.summary, s.todaySummary, compact && s.compactSummary, view === "today" && s.selectedToday]} onPress={() => { setView("today"); setPeriod("This Week"); setFilterOpen(false); }}>
        <Ionicons name="time" size={24} color="#A16A00" />
        <View style={[s.summaryContent, compact && s.centerSummary]}><Text accessibilityLiveRegion="polite" style={[s.summaryNumber, s.todayLabel]}>{countsReady ? dueToday.length : "—"}</Text><Text style={[s.summaryLabel, s.todayLabel]}>Due today</Text></View>
      </Pressable>
    </View>
    <View style={s.filters}>
      <Pressable accessibilityRole="button" accessibilityLabel="Filter care tasks" accessibilityState={{ expanded: filterOpen }} style={s.periodButton} onPress={() => { animateFilter(); setFilterOpen(!filterOpen); }}><Ionicons name="calendar-outline" size={16} color="#FFFFFF" /><Text style={s.periodLabel}>{period}</Text><Ionicons name={filterOpen ? "chevron-up" : "chevron-down"} size={14} color="#FFFFFF" /></Pressable>
      <View style={s.views}>{(["all", "pending", "completed"] as const).map(option => <Pressable key={option} accessibilityRole="tab" accessibilityLabel={`Show ${option} care tasks`} accessibilityState={{ selected: view === option }} style={[s.viewButton, view === option && s.activeView]} onPress={() => setView(option)}><Text style={[s.viewLabel, view === option && s.activeLabel]}>{option === "all" ? "All" : option === "pending" ? "Pending" : "Completed"}</Text></Pressable>)}</View>
    </View>
    {filterOpen && <View style={s.filterMenu}>{careTaskPeriods.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={`Show ${option} tasks`} accessibilityState={{ selected: period === option }} style={s.filterButton} onPress={() => { animateFilter(); setPeriod(option); if (view === "today") setView("pending"); setFilterOpen(false); }}><Text style={s.link}>{option}</Text>{period === option && <Ionicons name="checkmark" size={16} color="#278448" />}</Pressable>)}</View>}
    {(data.loading || remote.loading || (!local.ready && !local.error)) && <View style={s.loading}><ActivityIndicator size="small" color="#278448" /><Text style={s.details}>{countsReady ? "Refreshing tasks…" : "Loading care tasks…"}</Text></View>}
    {!!data.error && <><Notice>{data.error}{data.loaded ? " Showing saved plants." : ""}</Notice><Action label="Retry loading plants" onPress={() => void data.refresh()} /></>}
    {!!remote.error && !data.guest && <><Notice>Scan tasks could not refresh. Saved tasks may be out of date; local checks are available.</Notice><Action label="Retry scan tasks" onPress={() => void remote.refresh().catch(() => undefined)} /></>}
    {!!local.error && <><Notice>Local care could not load. Your saved data has not been replaced.</Notice><Action label="Retry local care" onPress={() => void local.retry()} /></>}
    {!!error && <><Notice>{error}</Notice><Action label="Refresh care tasks" onPress={refresh} /></>}
    {disabled && (saving || remote.saving) && <Text accessibilityLiveRegion="polite" style={s.source}>Saving task…</Text>}
    {countsReady && <>
      {showPending && <>{section("Overdue", groups.overdue)}{section("Today", groups.today)}{section("Manual checks", groups.manual)}{section("Upcoming", groups.upcoming)}</>}
      {showCompleted && section("Completed", groups.completed, true)}
      {view === "today" && <>{section("Overdue", tasksDueToday(allGroups.overdue, now))}{section("Today", tasksDueToday(allGroups.today, now))}</>}
      {clearEmpty && ((view === "completed" && !groups.completed.length)
        ? <View style={s.empty}><Ionicons name="checkmark-circle-outline" size={40} color="#299B57" /><Text style={s.sectionTitle}>No Completed Task!</Text></View>
        : (view === "today" ? !dueToday.length : (showPending && !pendingCount && (!showCompleted || !groups.completed.length))) && <View style={s.empty}><Ionicons name="leaf-outline" size={40} color="#299B57" /><Text style={s.sectionTitle}>All Caught Up!</Text><Text style={s.emptyText}>{view === "today" ? "No tasks due today." : "No Pending Tasks."}</Text></View>)}
    </>}
  </Screen></View>;
}
const s = StyleSheet.create({
  page: { flex: 1, minHeight: 0, backgroundColor: "#FFFFFF" },
  header: { gap: 4, paddingTop: 12, paddingBottom: 6 }, title: { fontSize: 32, fontWeight: "800", color: "#091D21", maxWidth: "82%" }, titleAccent: { color: "#299B57" },
  subtitle: { fontSize: 13, lineHeight: 20, color: "#506557", maxWidth: "75%" },
  summaries: { flexDirection: "row", gap: 8 },
  summary: { flex: 1, minWidth: 0, minHeight: 88, borderRadius: 22, paddingHorizontal: 10, paddingVertical: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: "transparent" },
  summaryContent: { minWidth: 0, flexShrink: 1 }, summaryNumber: { fontSize: 26, fontWeight: "800", color: "#091D21" }, summaryLabel: { fontSize: 11, fontWeight: "600", color: "#305F46", flexShrink: 1 },
  compactSummary: { flexDirection: "column", flexWrap: "nowrap", gap: 4 }, centerSummary: { alignItems: "center" },
  pendingSummary: { backgroundColor: "#E5F6E1" }, completedSummary: { backgroundColor: "#E9F5F0" }, todaySummary: { backgroundColor: "#FFF0D9" }, todayLabel: { color: "#895600" },
  selectedSummary: { borderColor: "#278448" }, selectedToday: { borderColor: "#A16A00" },
  filters: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  views: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, viewButton: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", alignItems: "center", borderRadius: 24, backgroundColor: "rgba(241,246,243,0.96)" },
  activeView: { backgroundColor: "#E6F3EC" }, viewLabel: { fontSize: 12, fontWeight: "600", color: "#506557" }, activeLabel: { color: "#174C33" },
  periodButton: { minHeight: 44, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 24, backgroundColor: "#17633A" }, periodLabel: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },
  filterButton: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, filterMenu: { alignSelf: "flex-start", minWidth: 160, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E8E8E8", borderRadius: 16, paddingVertical: 4 },
  section: { gap: 10 }, sectionHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }, sectionTitle: { color: "#091D21", fontSize: 19, fontWeight: "700", textAlign: "center" }, count: { color: "#1B6B36", fontSize: 13, fontWeight: "700", paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#E8F5EC", borderRadius: 16 },
  card: { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#EFF2EE", borderRadius: 24, padding: 12, gap: 10, boxShadow: "0px 3px 12px rgba(25,62,39,0.06)" }, cardBody: { flex: 1, minWidth: 0, gap: 4 },
  taskRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 6 }, taskContent: { flexGrow: 1, flexShrink: 1, flexBasis: 110, minWidth: 0 }, taskTitle: { color: "#091D21", fontSize: 16, fontWeight: "700", lineHeight: 22 }, completedTitle: { color: "#506557" },
  plantLink: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 5, alignSelf: "flex-start", maxWidth: "100%" }, plantName: { color: "#506557", fontSize: 13, flexShrink: 1 },
  actionControl: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, backgroundColor: "#E8F7EE", justifyContent: "center", alignItems: "center", maxWidth: "100%" },
  actionLabel: { fontSize: 11, color: "#17633A", fontWeight: "700", textAlign: "center" },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5 }, due: { fontSize: 12, color: "#506557", flexShrink: 1 }, overdue: { color: "#8A651E" }, attention: { fontSize: 11, color: "#8A651E", backgroundColor: "#FFF3CF", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  details: { color: "#506557", fontSize: 13, lineHeight: 20 }, footer: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }, source: { fontSize: 11, color: "#506557", backgroundColor: "#F1F5F2", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 1 },
  textButton: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 4 }, link: { fontSize: 12, fontWeight: "600", color: "#1B6B36" },
  disabled: { opacity: 0.45 }, loading: { flexDirection: "row", alignItems: "center", gap: 8 }, empty: { flex: 1, minHeight: 180, justifyContent: "center", paddingVertical: 24, gap: 10, alignItems: "center" },
  emptyText: { color: "#506557", fontSize: 13, lineHeight: 20, textAlign: "center" },
});
