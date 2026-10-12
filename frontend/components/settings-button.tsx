import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet } from "react-native";
import { AnimatedPressable } from "./animated-pressable";

export function SettingsButton() {
  const router = useRouter();
  return <AnimatedPressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push("/settings")} style={s.button}>
    <Ionicons name="settings-outline" size={24} color="#278448" />
  </AnimatedPressable>;
}
const s = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
});
