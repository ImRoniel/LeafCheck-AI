import { DashboardDailyDigest } from "@/components/DashboardDailyDigest";
import { DashboardPlantHighlights } from "@/components/DashboardPlantHighlights";
import { DashboardSensorStatusSheet } from "@/components/DashboardSensorStatusSheet";
import { GreetingHeader } from "@/components/greeting-header";
import { Action, Screen } from "@/components/screen";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
export default function Home() {
  const dashboard = useDashboardData();
  const { data, summary, sensors, now } = dashboard;
  const router = useRouter();
  const [sensorSheet, setSensorSheet] = useState(false);
  const refresh = () => { void dashboard.refresh(); };
  const openPlant = (id: string) => {
    setSensorSheet(false);
    const plant = data.plants.find(item => item.id === id);
    if (!plant) return;
    router.push(data.guest ? { pathname: "/(tabs)/space-detail", params: { space: plant.location?.trim() || "Unassigned" } }
      : { pathname: "/plant-profile", params: { id } });
  };
  return <View style={s.page}>
    <Screen refresh={refresh} loading={dashboard.refreshing} backgroundColor="#F4F9F4">
      <GreetingHeader plantCount={data.plants.length} ready={data.loaded} now={now} />
      {dashboard.error && <View style={s.error}><Text accessibilityLiveRegion="polite" style={s.note}>{dashboard.error}{data.loaded ? " Showing saved plants." : ""}</Text><Action label="Retry dashboard" variant="secondary" onPress={refresh} /></View>}
      <DashboardDailyDigest summary={summary} sensors={sensors} now={now} ready={dashboard.ready} careReady={dashboard.careReady}
        scansReady={dashboard.scansReady} guest={data.guest} careError={dashboard.careError} scansError={dashboard.scansError}
        onAttention={() => router.navigate({ pathname: "/(tabs)/spaces", params: { filter: "needs-attention" } })}
        onTasks={() => router.push({ pathname: "/(tabs)/tasks", params: { period: summary.dueToday ? "Today" : "All dates" } })}
        onScans={() => router.push("/archives")}
        onSensors={() => setSensorSheet(true)} onRetry={refresh} />
      {data.loaded && (data.plants.length > 0 ? <DashboardPlantHighlights items={summary.highlights} onOpenPlant={openPlant}
        onViewAll={() => router.navigate({ pathname: "/(tabs)/spaces", params: { filter: "" } })} />
        : !data.error && <View style={s.empty}><Text accessibilityRole="header" style={s.emptyTitle}>Your garden starts here</Text><Text style={s.note}>Add a plant and make room for a little green.</Text><Action label="Add your first plant" onPress={() => router.navigate({ pathname: "/(tabs)/spaces", params: { filter: "" } })} /></View>)}
    </Screen>
    {sensorSheet && <DashboardSensorStatusSheet onClose={() => setSensorSheet(false)} onOpenPlant={openPlant} />}
  </View>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F4F9F4" }, error: { gap: 8 }, note: { fontSize: 14, lineHeight: 21, color: "#506557" },
  empty: { padding: 22, gap: 14, backgroundColor: "#FFFFFF", borderRadius: 22 }, emptyTitle: { color: "#193E27", fontSize: 20, fontWeight: "700" },
});
