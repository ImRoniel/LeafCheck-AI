import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "./animated-pressable";

export function SettingsRow({ label, detail, icon, muted = false, onPress }: {
  label: string; detail?: string; icon?: ComponentProps<typeof Ionicons>["name"]; muted?: boolean; onPress?: () => void;
}) {
  const content = <>
    {icon && <Ionicons name={icon} size={21} color={muted ? "#6C7D70" : "#278448"} />}
    <View style={s.body}><Text style={[s.label, muted && s.muted]}>{label}</Text>
      {detail && <Text style={s.detail}>{detail}</Text>}
    </View>
    {onPress && !muted && <Ionicons name="chevron-forward" size={18} color="#278448" />}
  </>;
  return onPress && !muted ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.row}>{content}</Pressable>
    : <View style={s.row}>{content}</View>;
}
const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingHorizontal: 16, paddingVertical: 14 },
  body: { flex: 1, minWidth: 0, gap: 4 }, label: { color: "#1A4D2E", fontSize: 15, fontWeight: "600" },
  detail: { color: "#607065", fontSize: 12, lineHeight: 18 }, muted: { color: "#6C7D70", fontWeight: "400" },
});
