import type { Plant } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

/** A saved link, not a claim that the sensor is online or readings are fresh. */
export function sensorPairingLabel(plant: Pick<Plant, "deviceId" | "simulated">): string | null {
  if (!plant.deviceId?.trim()) return null;
  return plant.simulated ? "Demo sensor" : "Sensor paired";
}

export function PlantSensorBadge({ plant }: { plant: Pick<Plant, "deviceId" | "simulated"> }) {
  if (!sensorPairingLabel(plant)) return null;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.badge}>
    <Ionicons name="wifi" size={18} color="#278448" />
  </View>;
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute", top: 8, left: 8, width: 28, height: 28,
    borderRadius: 14, backgroundColor: "#FFFFFF", borderWidth: 1,
    borderColor: "#DBE7DA", alignItems: "center", justifyContent: "center",
  },
});
