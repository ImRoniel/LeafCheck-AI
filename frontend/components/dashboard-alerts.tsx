import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function DashboardAlerts({ message }: { message: string | null }) {
  // Account-provider remounts reset this dismissal at session boundaries.
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  if (!message || message === dismissedMessage) return null;

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Alerts
      </Text>
      <Text accessibilityLiveRegion="polite" style={styles.message}>
        {message}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Connect device, pairing unavailable in this app version"
          accessibilityState={{ disabled: true }}
          disabled
          style={[styles.button, styles.connect]}
        >
          <Text style={styles.buttonText}>Connect Device (unavailable)</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss sensor alert"
          onPress={() => setDismissedMessage(message)}
          style={[styles.button, styles.dismiss]}
        >
          <Text style={styles.buttonText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#193E27",
    borderRadius: 21,
    padding: 18,
    gap: 12,
  },
  title: { color: "#F5B800", fontSize: 18, fontWeight: "700" },
  message: { color: "#FFFFFF", fontSize: 15, lineHeight: 23 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  button: {
    flexGrow: 1,
    flexBasis: 130,
    minHeight: 48,
    padding: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  connect: { backgroundColor: "#F5B800" },
  dismiss: { backgroundColor: "#DBE7DA" },
  buttonText: { color: "#193E27", fontWeight: "700", textAlign: "center" },
});
