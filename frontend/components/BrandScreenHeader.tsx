import { StyleSheet, Text, View } from "react-native";

export function BrandScreenHeader({ first, second, subtitle }: { first: string; second: string; subtitle: string }) {
  return <View style={s.header}>
    <Text accessibilityRole="header" accessibilityLabel={`${first} ${second}`} style={s.title}>
      {first}{"\n"}<Text style={s.accent}>{second}</Text>
    </Text>
    <Text style={s.subtitle}>{subtitle}</Text>
  </View>;
}

const s = StyleSheet.create({
  header: { flexShrink: 1, gap: 6 },
  title: { fontSize: 36, lineHeight: 39, fontWeight: "700", color: "#111111" },
  accent: { color: "#278448" },
  subtitle: { fontSize: 13, lineHeight: 20, color: "#506557" },
});
