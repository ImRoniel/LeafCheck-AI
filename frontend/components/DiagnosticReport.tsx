import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** Mount with the diagnosis ID as its key so each report starts collapsed. */
export function DiagnosticReport({ text, readMoreLabel = "Read More" }: { text: string; readMoreLabel?: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.container}>
      {expanded ? text.split(/\n/).map((line, index) => {
        const heading = /^\s*#{1,6}\s/.test(line) || /^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(line);
        const content = line.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/^\s*[-*]\s+/, "• ");
        return content.trim() ? <Text key={index} selectable accessibilityRole={heading ? "header" : undefined} style={[styles.body, heading && { fontWeight: "700", marginTop: 8 }]}>{content}</Text> : null;
      }) : <Text selectable style={styles.body} numberOfLines={3} ellipsizeMode="tail">{text.replace(/^\s*#{1,6}\s*/gm, "").replace(/\*\*/g, "")}</Text>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Read Less" : readMoreLabel}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>{expanded ? "Read Less" : readMoreLabel}</Text>
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
