import { Action, Notice, Screen, ui } from "@/components/screen";
import { api } from "@/services/api";
import { groupArchives } from "@/services/archive-groups";
import { usePollingResource } from "@/services/use-polling-resource";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

const filters = [{ label: "Last 7 days", value: 7 }, { label: "Last 30 days", value: 30 }, { label: "All time", value: "all" }] as const;

export default function Archives() {
  const params = useLocalSearchParams<{ plantId?: string | string[] }>();
  const plantId = typeof params.plantId === "string" ? params.plantId : undefined;
  const invalidFilter = params.plantId !== undefined && (!plantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(plantId));
  const [range, setRange] = useState<7 | 30 | "all">("all");
  const key = JSON.stringify(["scan-archives", plantId, range]);
  const resource = usePollingResource(invalidFilter ? "" : key, async signal => ({
    key, entries: await api.fetchArchives({ signal, plantId, ...(range === "all" ? {} : { days: range }) }),
  }), { enabled: !invalidFilter, pollIntervalMs: 60_000 });
  const groups = groupArchives(resource.data?.key === key ? resource.data.entries : [], plantId);
  const { loading, error } = resource;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const reload = () => { void resource.refresh().catch(() => undefined); };

  return <Screen title="Scan history" back refresh={reload} loading={loading}>
    <Text style={ui.text}>{plantId ? "Saved diagnoses for this plant" : "Saved diagnoses grouped by plant"}</Text>
    <View style={s.filters}>
      {filters.map(filter => <Pressable key={filter.label} accessibilityRole="button"
        accessibilityState={{ selected: range === filter.value }} style={[s.filter, range === filter.value && s.selectedFilter]}
        onPress={() => { setRange(filter.value); setExpandedId(null); }}>
        <Text style={[s.filterText, range === filter.value && s.selectedText]}>{filter.label}</Text>
      </Pressable>)}
    </View>
    {invalidFilter && <Notice>Missing or invalid plant ID.</Notice>}
    {error && <><Notice>{error.message}</Notice><Action label="Retry loading archives" variant="secondary" onPress={reload} /></>}
    {loading && !groups.length && <ActivityIndicator accessibilityLabel="Loading scan history" color="#278448" />}
    {!invalidFilter && !loading && !error && !groups.length && <Notice>No scans found for this date range.</Notice>}
    {groups.map(group => <View key={group.plantId} style={s.group}>
      <View style={s.groupHeader}>
        <Text accessibilityRole="header" style={s.plantName}>{group.name}</Text>
        <Text style={s.meta}>{group.scans.length} {group.scans.length === 1 ? "scan" : "scans"}</Text>
      </View>
      <Text style={s.meta}>{group.species}</Text>
      {group.scans.map(entry => {
        const expanded = expandedId === entry.id;
        const color = entry.healthStatus === "critical" ? "#B42318" : entry.healthStatus === "warning" ? "#89610C" : "#278448";
        return <View key={entry.id} style={s.scan}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? "Hide" : "Show"} scan details for ${group.name}, ${new Date(entry.createdAt).toLocaleString()}`}
            accessibilityState={{ expanded }} style={s.scanHeader} onPress={() => setExpandedId(expanded ? null : entry.id)}>
            <View style={s.scanSummary}>
              <Text style={s.date}>{new Date(entry.createdAt).toLocaleString()}</Text>
              <Text style={[s.status, { color }]}>{entry.healthStatus}</Text>
            </View>
            <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#506557" />
          </Pressable>
          {expanded && <View style={s.details}>
            {entry.notificationTime && <Text style={s.meta}>Follow-up · {new Date(entry.notificationTime).toLocaleString()}{entry.notificationReason ? ` — ${entry.notificationReason}` : ""}</Text>}
            <Text style={s.detailsHeading}>Diagnostic report</Text>
            <Text style={s.report}>{entry.rawAnalysisText || "No diagnostic text was saved."}</Text>
          </View>}
        </View>;
      })}
    </View>)}
  </Screen>;
}

const s = StyleSheet.create({
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: { paddingHorizontal: 12, minHeight: 44, justifyContent: "center", borderRadius: 8, backgroundColor: "#F0F3F0" },
  selectedFilter: { backgroundColor: "#278448" },
  filterText: { fontSize: 13, color: "#365340" }, selectedText: { color: "#FFFFFF", fontWeight: "600" },
  group: { gap: 4, marginTop: 12 }, groupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  plantName: { fontSize: 18, fontWeight: "600", color: "#193E27", flex: 1 },
  meta: { fontSize: 12, lineHeight: 18, color: "#506557" },
  scan: { borderBottomWidth: 1, borderBottomColor: "#DFE7DF" },
  scanHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 44 },
  scanSummary: { flex: 1, gap: 4 }, date: { fontSize: 14, color: "#193E27" }, status: { fontSize: 12, textTransform: "capitalize" },
  details: { gap: 8, paddingBottom: 16 }, detailsHeading: { fontSize: 13, fontWeight: "600", color: "#193E27" },
  report: { fontSize: 14, lineHeight: 21, color: "#365340" },
});
