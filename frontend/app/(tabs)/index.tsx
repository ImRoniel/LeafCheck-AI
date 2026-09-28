import { DashboardAiSummary } from "@/components/dashboard-ai-summary";
import { DashboardAlerts } from "@/components/dashboard-alerts";
import { GreetingHeader } from "@/components/greeting-header";
import { PlantOverviewCard } from "@/components/plant-overview-card";
import { Screen } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import {
  getDashboardAlert,
  getDashboardCollectionStatus,
} from "@/services/dashboard-summary";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function Home() {
  const data = useAppData();
  const local = useLocalState();
  const connectedCount = local.data.connectedDevices.length;
  const router = useRouter();

  return (
    <View style={{ flex: 1 }}>
      <Screen refresh={() => void data.refresh()} loading={data.loading}>
        <View style={s.topBackground} />
        <GreetingHeader mockConnected={connectedCount > 0} />

        <View style={s.quickActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan Plant"
            style={s.scanBanner}
            onPress={() => router.push("/(tabs)/scanner")}
          >
            <View style={s.scanBannerIcon}>
              <Ionicons name="scan-outline" size={28} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.scanBannerTitle}>Scan Plant</Text>
              <Text style={s.scanBannerSubtitle}>
                Point camera at any plant for instant AI identification & care
                specs
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pair Sensor"
            accessibilityHint="Open demo sensor pairing and choose any plant or space"
            style={[s.scanBanner, s.pairAction]}
            onPress={() => router.push("/device-connection/scanner")}
          >
            <View style={s.scanBannerIcon}>
              <Ionicons name="radio-outline" size={28} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.scanBannerTitle}>Pair Sensor</Text>
              <Text style={s.scanBannerSubtitle}>
                Add a demo sensor to a plant or space
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        <DashboardAlerts
          message={getDashboardAlert(data)}
          connectedCount={connectedCount}
          onConnect={() => router.push("/device-connection/scanner")}
          onManage={() => router.push("/device-connection/manage")}
        />
        {data.loaded && <PlantOverviewCard />}
        <DashboardAiSummary
          collectionStatus={getDashboardCollectionStatus(data)}
          onRetry={() => void data.refresh()}
        />
      </Screen>
    </View>
  );
}

const s = StyleSheet.create({
  topBackground: {
    position: "absolute",
    top: 0,
    width: 476,
    height: 263,
    left: "50%",
    marginLeft: -238,
    backgroundColor: "#2F8135",
    borderBottomLeftRadius: 112,
    borderBottomRightRadius: 112,
  },
  quickActions: {
    backgroundColor: "#1B5E20",
    borderRadius: 18,
    marginVertical: 10,
    overflow: "hidden",
  },
  pairAction: { borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.3)" },
  scanBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1B5E20",
    minHeight: 80,
    padding: 16,
  },
  scanBannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanBannerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  scanBannerSubtitle: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.85)",
    marginTop: 2,
    lineHeight: 16,
  },
});
