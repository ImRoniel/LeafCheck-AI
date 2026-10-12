import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Plant } from "@/types/plant";
import { DashboardPlantCard } from "./DashboardPlantCard";

export function UnassignedPlantsSection({ plants, onOpen }: { plants: readonly Plant[]; onOpen: (plant: Plant) => void }) {
  if (!plants.length) return null;
  return <View style={s.section}>
    <Text accessibilityRole="header" style={s.title}>Unassigned Plants</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.plants}>
      {plants.map(plant => <DashboardPlantCard key={plant.id} item={{
        plant, rank: 0, attention: plant.healthStatus === "warning" || plant.healthStatus === "critical",
        reason: plant.healthStatus === "healthy" ? "Healthy" : plant.healthStatus === "warning" ? "Needs Attention"
          : plant.healthStatus === "critical" ? "Critical" : "Not assessed",
      }} onPress={() => onOpen(plant)} />)}
    </ScrollView>
  </View>;
}

const s = StyleSheet.create({
  section: { alignSelf: "stretch", gap: 12, marginTop: 12 },
  title: { color: "#1A4D2E", fontSize: 19, fontWeight: "800" },
  plants: { gap: 12, paddingBottom: 12, paddingHorizontal: 2 },
});
