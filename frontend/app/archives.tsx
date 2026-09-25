import { Action, Notice, Screen, ui } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { api } from "@/services/api";
import type { ArchiveEntry } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function Archives() {
  const auth = useAuth();
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadArchives = async () => {
    if (auth.status !== "authenticated") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.fetchArchives();
      setArchives(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load archives.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadArchives();
  }, [auth.status]);

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const getHealthBadgeStyle = (status: string) => {
    switch (status) {
      case "healthy":
        return { bg: "#E8F5E9", text: "#2E7D32", label: "HEALTHY" };
      case "warning":
        return { bg: "#FFF8E1", text: "#F57F17", label: "WARNING" };
      case "critical":
        return { bg: "#FFEBEE", text: "#C62828", label: "CRITICAL" };
      default:
        return { bg: "#ECEFF1", text: "#546E7A", label: status.toUpperCase() };
    }
  };

  return (
    <Screen
      title="SCAN ARCHIVES"
      back
      refresh={() => void loadArchives()}
      loading={loading}
    >
      <Notice>
        Diagnostic history and AI plant assessments generated from your camera scans.
      </Notice>

      {error && (
        <>
          <Notice>{error}</Notice>
          <Action label="Retry loading archives" onPress={() => void loadArchives()} />
        </>
      )}

      {loading && archives.length === 0 && (
        <View style={s.centerBox}>
          <ActivityIndicator size="large" color="#2F8135" />
          <Text style={[ui.text, { marginTop: 12 }]}>Loading scan archives…</Text>
        </View>
      )}

      {!loading && archives.length === 0 && !error && (
        <View style={[ui.card, s.emptyCard]}>
          <Ionicons name="archive-outline" size={48} color="#888" />
          <Text style={[ui.heading, { marginTop: 12 }]}>No Archives Yet</Text>
          <Text style={[ui.text, { textAlign: "center", marginTop: 6 }]}>
            When you scan plants using the AI camera, their detailed diagnostic reports
            and care recommendations are permanently archived here.
          </Text>
        </View>
      )}

      {archives.map((entry) => {
        const badge = getHealthBadgeStyle(entry.healthStatus);
        const isExpanded = expandedId === entry.id;
        const scanDate = new Date(entry.createdAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <View key={entry.id} style={[ui.card, s.archiveCard]}>
            <View style={s.cardHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.plantName}>
                  {entry.plant?.name ?? entry.speciesName ?? "Unknown Plant"}
                </Text>
                <Text style={s.speciesText}>
                  {entry.plant?.species ?? entry.speciesName ?? "Unidentified species"}
                </Text>
              </View>
              <View style={[s.badge, { backgroundColor: badge.bg }]}>
                <Text style={[s.badgeText, { color: badge.text }]}>
                  {badge.label}
                </Text>
              </View>
            </View>

            <View style={s.metaRow}>
              <Ionicons name="calendar-outline" size={14} color="#666" />
              <Text style={s.metaText}>{scanDate}</Text>
            </View>

            {entry.notificationTime && (
              <View style={s.notificationBox}>
                <Ionicons name="notifications-outline" size={16} color="#1565C0" />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={s.notificationTime}>
                    Follow-up:{" "}
                    {new Date(entry.notificationTime).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                  {entry.notificationReason ? (
                    <Text style={s.notificationReason}>
                      {entry.notificationReason}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}

            {entry.rawAnalysisText && (
              <View style={s.reportContainer}>
                <Pressable
                  accessibilityRole="button"
                  style={s.toggleButton}
                  onPress={() => toggleExpand(entry.id)}
                >
                  <Text style={s.toggleButtonText}>
                    {isExpanded ? "Hide Diagnostic Report" : "View Diagnostic Report"}
                  </Text>
                  <Ionicons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color="#2F8135"
                  />
                </Pressable>

                {isExpanded && (
                  <View style={s.reportBody}>
                    <Text style={s.reportText}>{entry.rawAnalysisText}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        );
      })}
    </Screen>
  );
}

const s = StyleSheet.create({
  centerBox: {
    paddingVertical: 32,
    alignItems: "center",
  },
  emptyCard: {
    alignItems: "center",
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  archiveCard: {
    padding: 16,
    borderRadius: 16,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  plantName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1B3B2B",
  },
  speciesText: {
    fontSize: 13,
    fontStyle: "italic",
    color: "#5C6F64",
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: "#666",
  },
  notificationBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#E3F2FD",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
  },
  notificationTime: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0D47A1",
  },
  notificationReason: {
    fontSize: 11,
    color: "#1565C0",
    marginTop: 2,
  },
  reportContainer: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    paddingTop: 10,
  },
  toggleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  toggleButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2F8135",
  },
  reportBody: {
    marginTop: 8,
    padding: 12,
    backgroundColor: "#F8FAF8",
    borderRadius: 10,
  },
  reportText: {
    fontSize: 13,
    lineHeight: 19,
    color: "#2E3D32",
  },
});
