import { StyleSheet, Text, View } from "react-native";
import { Action, Screen } from "./screen";
import { CareTaskThumbnail } from "./care-task-thumbnail";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { plantsNeedingAttention } from "@/services/plant-attention";
import type { Plant } from "@/types/plant";
export function NeedsAttentionPlantList({ plants, ready, loading, error, onRefresh, onClear, onOpen }: {
  plants: readonly Plant[]; ready: boolean; loading: boolean; error: string | null;
  onRefresh: () => void; onClear: () => void; onOpen: (plant: Plant) => void;
}) {
  const attention = plantsNeedingAttention(plants);
  return <Screen title="Needs Attention" refresh={onRefresh} loading={loading} backgroundColor="#F4F9F4">
    <Text style={s.description}>Plants with a saved Warning or Critical health status.</Text>
    <Action label="View all spaces" variant="secondary" onPress={onClear} />
    {(!ready || loading) && <Text accessibilityLiveRegion="polite" style={s.description}>Updating plant health…</Text>}
    {error && <View style={s.error}><Text style={s.description}>Couldn’t refresh plant health.{ready ? " Showing saved plants." : ""}</Text><Action label="Retry plant health" variant="secondary" onPress={onRefresh} /></View>}
    {ready && attention.map(plant => <Pressable key={plant.id} accessibilityRole="button" accessibilityLabel={`Open ${plant.name}, ${plant.healthStatus} health status`} onPress={() => onOpen(plant)} style={s.card}>
      <CareTaskThumbnail uri={plant.imageUrl} name={plant.name} />
      <View style={s.body}><Text style={s.name}>{plant.name}</Text><Text style={s.species}>{plant.species}</Text>
        <Text style={[s.badge, plant.healthStatus === "critical" && s.critical]}>{plant.healthStatus === "critical" ? "Critical" : "Warning"}</Text>
        {plant.lastScannedAt && <Text style={s.date}>Last scan · {new Date(plant.lastScannedAt).toLocaleDateString()}</Text>}
      </View><Text style={s.chevron}>›</Text>
    </Pressable>)}
    {ready && !loading && !error && !attention.length && <Text style={s.description}>No plants with Warning or Critical status.</Text>}
  </Screen>;
}
const s = StyleSheet.create({
  description: { color: "#506557", fontSize: 14, lineHeight: 21 }, error: { gap: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, backgroundColor: "#FFFFFF", borderRadius: 20, borderWidth: 1, borderColor: "#D4E7D5", boxShadow: "0px 4px 12px rgba(26,77,46,0.08)" },
  body: { flex: 1, gap: 5 }, name: { fontSize: 17, fontWeight: "700", color: "#1A4D2E" }, species: { fontSize: 13, color: "#506557" },
  badge: { alignSelf: "flex-start", color: "#8A4B0C", backgroundColor: "#FFF0D9", fontSize: 12, fontWeight: "700", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  critical: { backgroundColor: "#FDE8E7", color: "#A62C25" }, date: { fontSize: 12, color: "#506557" }, chevron: { fontSize: 25, color: "#278448" },
});
