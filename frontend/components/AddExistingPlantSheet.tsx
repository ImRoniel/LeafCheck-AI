import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { Plant } from "@/types/plant";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { CareTaskThumbnail } from "./care-task-thumbnail";
import { TaskSheet } from "./task-sheet";

export function AddExistingPlantSheet({ space, plants, addingId, error, onSelect, onCreate, onClose }: {
  space: string; plants: readonly Plant[]; addingId: string | null; error: string;
  onSelect: (id: string) => void; onCreate: () => void; onClose: () => void;
}) {
  const busy = addingId !== null;
  return <TaskSheet title={`Add to ${space}`} onClose={onClose} footer={<Pressable accessibilityRole="button"
    accessibilityLabel="Create a new plant instead" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onCreate} style={s.secondary}>
    <Text style={s.link}>Create a new plant instead</Text>
  </Pressable>}>
    <Text style={s.description}>Choose an unassigned plant to move into this space.</Text>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!plants.length && <Text style={s.description}>No unassigned plants available.</Text>}
    {plants.map(plant => <Pressable key={plant.id} accessibilityRole="button" accessibilityLabel={`Add ${plant.name} to ${space}`}
      accessibilityState={{ disabled: busy, busy: addingId === plant.id }} disabled={busy} onPress={() => onSelect(plant.id)} style={[s.row, busy && s.busy]}>
      <CareTaskThumbnail uri={plant.imageUrl} name={plant.name} />
      <View style={s.body}><Text numberOfLines={1} style={s.name}>{plant.name}</Text>
        <Text numberOfLines={2} style={s.species}>{plant.species}</Text>
        <Text style={[s.badge, plant.healthStatus === "warning" && s.warning, plant.healthStatus === "critical" && s.critical]}>
          {plant.healthStatus === "healthy" ? "Healthy" : plant.healthStatus === "warning" ? "Needs Attention" : plant.healthStatus === "critical" ? "Critical" : "Not assessed"}
        </Text>
      </View>
      {addingId === plant.id ? <ActivityIndicator color="#278448" accessibilityLabel={`Moving ${plant.name}`} /> : <Text style={s.plus}>+</Text>}
    </Pressable>)}
  </TaskSheet>;
}

const s = StyleSheet.create({
  description: { color: "#506557", fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: "#D4E7D5", backgroundColor: "#FFFFFF" },
  body: { flex: 1, gap: 4 }, name: { fontSize: 16, fontWeight: "700", color: "#1A4D2E" }, species: { color: "#506557", fontSize: 13, lineHeight: 18 },
  badge: { alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#E7F4E9", color: "#216B3D", fontSize: 11, fontWeight: "600" },
  warning: { backgroundColor: "#FFF0D9", color: "#8A4B0C" }, critical: { backgroundColor: "#FDE8E7", color: "#A62C25" },
  plus: { fontSize: 24, color: "#278448" }, busy: { opacity: 0.6 },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderTopColor: "#E2EEE3" },
  link: { color: "#278448", fontSize: 14, fontWeight: "600" }, error: { color: "#A62C25", fontSize: 14, lineHeight: 21 },
});
