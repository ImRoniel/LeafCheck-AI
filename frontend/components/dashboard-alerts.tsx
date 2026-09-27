import { Pressable, StyleSheet, Text, View } from "react-native";

export function DashboardAlerts({
  message,
  connectedCount,
  onConnect,
  onManage,
}: {
  message: string | null;
  connectedCount: number;
  onConnect: () => void;
  onManage: () => void;
}) {
  const connected = connectedCount > 0;

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {connected ? "Connected Hardware" : "Alerts"}
      </Text>
      <Text accessibilityLiveRegion="polite" style={styles.message}>
        {connected
          ? `${connectedCount} Demo Sensor${connectedCount === 1 ? "" : "s"} Paired • Mode: Auto (With IoT)`
          : "No sensors detected by pairing setup"}
      </Text>
      <Text style={styles.message}>
        {connected
          ? "Mock setup · No live connection or automatic watering."
          : (message ??
            "Sensor status is not verified while your collection loads. Pair Sensor previews a demo setup; no physical discovery is performed.")}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={connected ? "Add Sensor" : "Connect Device"}
          accessibilityHint="Opens a mock device setup; no physical hardware will be connected"
          onPress={onConnect}
          style={[styles.button, styles.connect]}
        >
          <Text style={styles.buttonText}>
            {connected ? "+ Add Sensor" : "Connect Device"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Manage Devices"
          onPress={onManage}
          style={[styles.button, styles.dismiss]}
        >
          <Text style={styles.buttonText}>Manage Devices</Text>
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
  title: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
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
  connect: { backgroundColor: "#FFFFFF" },
  dismiss: { backgroundColor: "#DBE7DA" },
  buttonText: { color: "#193E27", fontWeight: "700", textAlign: "center" },
});
