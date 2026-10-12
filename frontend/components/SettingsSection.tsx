import { Children, type PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

export function SettingsSection({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View style={s.section}>
    <Text accessibilityRole="header" style={s.title}>{title}</Text>
    <View style={s.card}>{Children.map(children, (child, index) => child && <View>
      {index > 0 && <View style={s.divider} />}{child}
    </View>)}</View>
  </View>;
}
const s = StyleSheet.create({
  section: { gap: 8 }, title: { color: "#1A4D2E", fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  card: { borderWidth: 1, borderColor: "#D4E7D5", borderRadius: 18, backgroundColor: "#FFFFFF", overflow: "hidden" },
  divider: { height: 1, backgroundColor: "#E4EEE5", marginHorizontal: 16 },
});
