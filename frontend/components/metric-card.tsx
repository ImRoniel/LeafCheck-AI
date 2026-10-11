import { Pressable, StyleSheet, Text, View } from "react-native";

export function MetricCard({
  title,
  value,
  unit,
  status,
  onPress,
  compact = false,
}: {
  title: string;
  value: string | number;
  unit?: string;
  status?: "healthy" | "warning" | "critical";
  onPress?: () => void;
  compact?: boolean;
}) {
  const statusColors = {
    healthy: "#4CAF50",
    warning: "#FFC107",
    critical: "#E53935",
  };

  const statusColor = status ? statusColors[status] : "#4CAF50";

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `${title}: ${value}${unit ? ` ${unit}` : ""}. About soil calibration` : undefined}
      style={[styles.container, compact && styles.compact]}
    >
      <Text style={[styles.title, compact && { color: "#506557" }]}>{title}</Text>
      <View style={styles.valueContainer}>
        <Text style={[styles.value, { color: compact ? "#193E27" : statusColor }, compact && { fontSize: 22, flexShrink: 1 }]}>{value}</Text>
        {unit && <Text style={styles.unit}>{unit}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: { flex: 1, width: "auto", height: "auto", minHeight: 100, padding: 10, borderRadius: 14, elevation: 0, shadowOpacity: 0 },
  container: {
    backgroundColor: "#FFFFFF",
    width: "48%",
    height: 104,
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E7E7E7",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  title: {
    fontSize: 13,
    color: "#F0A400",
    marginBottom: 8,
  },
  valueContainer: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  value: {
    fontSize: 27,
    fontWeight: "bold",
  },
  unit: {
    fontSize: 16,
    color: "#757575",
    marginLeft: 4,
  },
});
