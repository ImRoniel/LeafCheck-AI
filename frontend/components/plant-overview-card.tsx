import { useSpaces } from "@/context/spaces";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

export function PlantOverviewCard() {
  const router = useRouter();
  const { spaces, backgrounds, plantsBySpace } = useSpaces();
  const { width } = useWindowDimensions();
  const [activePage, setActivePage] = useState(0);
  const pageWidth = Math.max(280, width - 74);
  const visibleDots = Math.min(Math.max(spaces.length, 1), 5);
  const openSpaces = () => router.navigate("/(tabs)/spaces");
  const openSpace = (space: string) => router.navigate({ pathname: "/(tabs)/space-detail", params: { space } });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.overviewTitle}><Text style={styles.greenText}>Plant </Text>Overview</Text>
          <Text style={styles.subtitle}>From My Spaces</Text>
        </View>
      </View>
      {spaces.length === 0 ? (
        <Pressable onPress={openSpaces} accessibilityRole="button" accessibilityLabel="View spaces" style={styles.empty}>
          <Ionicons name="leaf-outline" size={58} color="#2D7D3D" />
          <Text style={styles.emptyTitle}>No spaces yet</Text>
          <Text style={styles.emptyText}>Spaces appear from the locations of plants returned by the API.</Text>
        </Pressable>
      ) : (
        <>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => setActivePage(Math.round(event.nativeEvent.contentOffset.x / pageWidth))}
          >
            {spaces.map((space) => {
              const plants = plantsBySpace[space] ?? [];
              return (
                <Pressable key={space} onPress={() => openSpace(space)} accessibilityRole="button" accessibilityLabel={`Open ${space} details`} style={[styles.carouselPage, { width: pageWidth, backgroundColor: backgrounds[space] ?? "#F3F8F2" }]}>
                  <Ionicons name="leaf-outline" size={105} color="#2D7D3D" />
                  <Text style={styles.spaceName}>{space}</Text>
                  <Text style={styles.count}>{plants.length} plants</Text>
                  <View style={styles.statusBadge}>
                    <View><Text style={styles.statusLabel}>Healthy</Text><Text style={styles.statusValue}>{plants.filter(p => p.healthStatus === 'healthy').length}</Text></View>
                    <View><Text style={styles.statusLabel}>Warning</Text><Text style={[styles.statusValue, { color: "#F4A900" }]}>{plants.filter(p => p.healthStatus === 'warning').length}</Text></View>
                    <View><Text style={styles.statusLabel}>Critical</Text><Text style={[styles.statusValue, { color: "#E53935" }]}>{plants.filter(p => p.healthStatus === 'critical').length}</Text></View>
                    <View><Text style={styles.statusLabel}>Unknown</Text><Text style={styles.statusValue}>{plants.filter(p => p.healthStatus === 'unknown').length}</Text></View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.carouselDots} accessibilityLabel={`${Math.min(activePage + 1, visibleDots)} of ${visibleDots} spaces`}>
            {Array.from({ length: visibleDots }, (_, index) => (
              <Pressable key={index} onPress={openSpaces} accessibilityRole="button" accessibilityLabel={`Open My Spaces, space ${index + 1}`} style={[styles.carouselDot, index === Math.min(activePage, visibleDots - 1) && styles.carouselDotActive]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#FFFFFF", borderRadius: 21, overflow: "hidden", marginBottom: 24, borderWidth: 1, borderColor: "#25B853", padding: 17, maxHeight: 360, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  overviewTitle: { fontSize: 18, fontWeight: "700", color: "#111111" },
  greenText: { color: "#25A84A" },
  subtitle: { fontSize: 12, color: "#777777", marginTop: 3 },
  empty: { minHeight: 210, backgroundColor: "#F3F8F2", borderRadius: 24, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: "#193E27", marginTop: 10 },
  emptyText: { color: "#66746A", textAlign: "center", marginTop: 6, lineHeight: 20 },
  carouselPage: { minHeight: 210, backgroundColor: "#F3F8F2", borderRadius: 24, alignItems: "center", justifyContent: "center" },
  spaceName: { position: "absolute", left: 13, bottom: 31, fontSize: 18, fontWeight: "700", color: "#FFFFFF", textShadowColor: "#193E27AA", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  count: { position: "absolute", left: 13, bottom: 11, color: "#FFFFFF", fontSize: 12, textShadowColor: "#193E27AA", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  statusBadge: { position: "absolute", right: 8, bottom: 8, width: 170, height: 35, backgroundColor: "#FFFFFF", paddingHorizontal: 8, borderRadius: 18, flexDirection: "row", justifyContent: "space-around", alignItems: "center", elevation: 2 },
  statusValue: { color: "#20B64D", fontSize: 14, lineHeight: 16, fontWeight: "700", textAlign: "center" },
  statusLabel: { color: "#111111", fontSize: 7, lineHeight: 9, textAlign: "center" },
  carouselDots: { flexDirection: "row", justifyContent: "center", gap: 7, marginTop: 12 },
  carouselDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#D0D0D0" },
  carouselDotActive: { backgroundColor: "#20B64D" },
  healthRow: { paddingTop: 14 },
  healthHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  healthLabel: { fontSize: 11, color: "#555555" },
  healthPercent: { fontSize: 11, color: "#20B64D" },
  healthTrack: { height: 7, borderRadius: 4, backgroundColor: "#E5E5E5", marginTop: 4, overflow: "hidden" },
  healthProgress: { height: 7, borderRadius: 4, backgroundColor: "#20B64D" },
  readingNote: { color: "#66746A", fontSize: 11, marginTop: 5 },
});
