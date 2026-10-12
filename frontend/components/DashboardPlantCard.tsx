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
      : <View accessibilityLabel={`${plant.name}: no plant photo`} style={[s.photo, s.placeholder]}><Ionicons name="leaf-outline" size={42} color="#1A4D2E" /></View>}
    <View style={s.body}><Text numberOfLines={1} style={s.name}>{plant.name}</Text>
      <Text numberOfLines={2} style={[s.reason, item.attention && s.attention]}>{item.reason}</Text>
    </View>
  </Pressable>;
}
const s = StyleSheet.create({
  card: { width: 166, borderRadius: 20, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D4E7D5", boxShadow: "0px 4px 12px rgba(26,77,46,0.10)", overflow: "hidden" },
  photo: { width: "100%", height: 148 }, placeholder: { backgroundColor: "#E3F0DE", alignItems: "center", justifyContent: "center" },
  body: { padding: 12, gap: 5 }, name: { fontSize: 15, fontWeight: "800", color: "#1A4D2E" },
  reason: { fontSize: 11, lineHeight: 17, fontWeight: "600", color: "#216B3D", minHeight: 36, backgroundColor: "#E7F4E9", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#CEE6D2" }, attention: { color: "#8A4B0C", backgroundColor: "#FFF0D9", borderColor: "#F2CD99" },
});
