import { GreetingHeader } from "@/components/greeting-header";
import { CollectionState, PlantList } from "@/components/plant-list";
import { PlantOverviewCard } from "@/components/plant-overview-card";
import { Screen, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useSpaces } from "@/context/spaces";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function Home() {
  const data = useAppData();
  const { spaces } = useSpaces();
  const router = useRouter();

  return (
    <View style={{ flex: 1 }}>
      <Screen refresh={() => void data.refresh()} loading={data.loading}>
        <View style={s.topBackground} />
        <GreetingHeader />

        {/* Scan-First Hero Action */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan to add plant"
          style={s.scanBanner}
          onPress={() => router.push("/(tabs)/camera")}
        >
          <View style={s.scanBannerIcon}>
            <Ionicons name="scan-outline" size={28} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={s.scanBannerTitle}>Scan to Add Plant</Text>
            <Text style={s.scanBannerSubtitle}>
              Point camera at any plant for instant AI identification & care specs
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
        </Pressable>

        <View style={ui.card}>
          <Text style={ui.heading}>Your growing world</Text>
          <Text style={ui.text}>
            {data.loaded
              ? `${data.plants.length} plants across ${spaces.length} locations.`
              : "Your API collection will appear here."}{" "}
            Health labels reflect backend records, not a calculated health score.
          </Text>
        </View>

        <CollectionState />
        {data.loaded && <PlantOverviewCard />}
        <Text style={ui.heading}>My plants</Text>
        <PlantList plants={data.plants} />
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
  scanBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1B5E20",
    borderRadius: 18,
    padding: 16,
    marginVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
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
