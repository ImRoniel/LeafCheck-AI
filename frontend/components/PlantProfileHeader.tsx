import type { Plant } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Action, ui } from "./screen";

export function PlantProfileHeader({ plant, onBack, onEdit, onDelete }: {
  plant: Plant; onBack: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const status = { healthy: "Healthy", warning: "Needs attention", critical: "Critical", unknown: "Not assessed" }[plant.healthStatus];
  return <View style={{ gap: 12 }}>
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.icon}>
        <Ionicons name="chevron-back" size={24} color="#193E27" />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Plant options" accessibilityState={{ expanded: menuOpen }} onPress={() => setMenuOpen(value => !value)} style={styles.icon}>
        <Ionicons name="ellipsis-horizontal" size={24} color="#193E27" />
      </Pressable>
    </View>
    {menuOpen && <View style={ui.card}>
      <Action label="Edit plant details" variant="secondary" onPress={() => { setMenuOpen(false); onEdit(); }} />
      <Action label="Delete plant" variant="destructive" onPress={() => { setMenuOpen(false); onDelete(); }} />
    </View>}
    <View style={styles.identity}>
      {plant.imageUrl && plant.imageUrl !== failedImageUrl ? <Image source={{ uri: plant.imageUrl }} accessibilityLabel={`${plant.name} photo`} onError={() => setFailedImageUrl(plant.imageUrl ?? null)} style={styles.photo} />
        : <View style={[styles.photo, styles.placeholder]}><Ionicons name="leaf-outline" size={48} color="#278448" /></View>}
      <View style={{ flex: 1, gap: 5 }}>
        <Text accessibilityRole="header" style={ui.title}>{plant.name}</Text>
        <Text style={ui.text}>{plant.species}</Text>
        {plant.location && <Text style={ui.text}>{plant.location}</Text>}
        <Text style={[styles.badge, plant.healthStatus === "warning" && styles.warning, plant.healthStatus === "critical" && styles.critical]}>{status}</Text>
      </View>
    </View>
    <Text style={styles.caption}>{plant.lastScannedAt ? `Latest AI scan · ${new Date(plant.lastScannedAt).toLocaleDateString()}` : "No AI scan yet"}</Text>
  </View>;
}
const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", justifyContent: "space-between" },
  icon: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  identity: { flexDirection: "row", gap: 16, alignItems: "center" },
  photo: { width: 96, height: 112, borderRadius: 18 },
  placeholder: { backgroundColor: "#E8F1E8", alignItems: "center", justifyContent: "center" },
  badge: { alignSelf: "flex-start", backgroundColor: "#EDF2EE", color: "#193E27", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, fontWeight: "600" },
  warning: { backgroundColor: "#FFF3CF", color: "#73551B" },
  critical: { backgroundColor: "#FCE8E6", color: "#A12A24" },
  caption: { color: "#506557", fontSize: 12 },
});
