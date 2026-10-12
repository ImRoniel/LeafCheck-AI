import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { DashboardPlantCard } from "./DashboardPlantCard";
import type { PlantHighlight } from "@/services/dashboard-summary";
export function DashboardPlantHighlights({ items, onOpenPlant, onViewAll }: { items: readonly PlantHighlight[]; onOpenPlant: (id: string) => void; onViewAll: () => void }) {
  return <View style={s.section}>
    <View style={s.header}><Text accessibilityRole="header" style={s.title}>Your garden</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="View all plants" onPress={onViewAll} style={s.link}><Text style={s.linkText}>View all ›</Text></Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.plants}>
      {items.map(item => <DashboardPlantCard key={item.plant.id} item={item} onPress={() => onOpenPlant(item.plant.id)} />)}
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  section: { gap: 6 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, title: { color: "#193E27", fontSize: 19, fontWeight: "700" },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }, linkText: { fontSize: 14, color: "#17633A", fontWeight: "600" }, plants: { gap: 12, paddingBottom: 4 },
});
