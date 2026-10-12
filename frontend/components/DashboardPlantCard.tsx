import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import type { PlantHighlight } from "@/services/dashboard-summary";
export function DashboardPlantCard({ item, onPress }: { item: PlantHighlight; onPress: () => void }) {
  const [failedUri, setFailedUri] = useState<string>();
  const plant = item.plant;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${plant.name}: ${item.reason}`} onPress={onPress} style={s.card}>
    {plant.imageUrl && failedUri !== plant.imageUrl
      ? <Image accessibilityLabel={`${plant.name} photo`} source={{ uri: plant.imageUrl }} onError={() => setFailedUri(plant.imageUrl)} resizeMode="cover" style={s.photo} />
      : <View accessibilityLabel={`${plant.name}: no plant photo`} style={[s.photo, s.placeholder]}><Ionicons name="leaf-outline" size={42} color="#47835A" /></View>}
    <View style={s.body}><Text numberOfLines={1} style={s.name}>{plant.name}</Text>
      <Text numberOfLines={2} style={[s.reason, item.attention && s.attention]}>{item.reason}</Text>
    </View>
  </Pressable>;
}
const s = StyleSheet.create({
  card: { width: 166, borderRadius: 20, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E1EAE2", overflow: "hidden" },
  photo: { width: "100%", height: 148 }, placeholder: { backgroundColor: "#EAF3E8", alignItems: "center", justifyContent: "center" },
  body: { padding: 12, gap: 5 }, name: { fontSize: 15, fontWeight: "700", color: "#193E27" },
  reason: { fontSize: 12, lineHeight: 18, color: "#506557", minHeight: 36 }, attention: { color: "#895600" },
});
