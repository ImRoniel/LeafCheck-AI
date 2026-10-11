import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** Mount with the diagnosis ID as its key so each report starts collapsed. */
export function DiagnosticReport({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.container}>
      <Text selectable style={styles.body} numberOfLines={expanded ? undefined : 3} ellipsizeMode="tail">
        {text}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Read Less" : "Read More"}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>{expanded ? "Read Less" : "Read More"}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#278448" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4 },
  body: { fontSize: 14, color: "#333D35", lineHeight: 22 },
  toggle: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, alignSelf: "flex-start" },
  toggleText: { color: "#278448", fontWeight: "600" },
});
