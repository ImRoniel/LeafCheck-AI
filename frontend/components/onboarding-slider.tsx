import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const slides = [
  {
    title: "Meet your plants",
    description: "Get to know your plants with a simple photo. A little insight goes a long way.",
    eyebrow: "DISCOVER",
    icon: "leaf-outline",
    caption: "A fresh start for every leaf",
  },
  {
    title: "Understand every leaf",
    description: "Capture a leaf for AI insights and connect your sensors to follow growing conditions.",
    eyebrow: "UNDERSTAND",
    icon: "scan-outline",
    caption: "Small details. Better care.",
  },
  {
    title: "Help your plants thrive",
    description: "Explore your plant collection by location and review real sensor readings when available.",
    eyebrow: "GROW",
    icon: "flower-outline",
    caption: "Your own little world of green",
  },
] as const;

export function OnboardingSlider({
  currentSlide,
  onPrevious,
  onNext,
  onGetStarted,
  onLetsGo,
}: {
  currentSlide: number;
  onPrevious: () => void;
  onNext: () => void;
  onGetStarted: () => void;
  onLetsGo: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const slide = slides[currentSlide];
  const compact = height < 740;
  const artworkSize = Math.max(120, Math.min(compact ? 210 : 280, width - insets.left - insets.right - 80));
  const nextAction = currentSlide === 0 ? onGetStarted : currentSlide === 2 ? onLetsGo : onNext;

  return (
    <View style={[styles.container, {
      paddingTop: insets.top + 12,
      paddingLeft: insets.left + 24,
      paddingRight: insets.right + 24,
    }]}>
      <View style={styles.header}>
        <View style={styles.backSlot}>
          {currentSlide > 0 && (
            <Pressable
              onPress={onPrevious}
              accessibilityRole="button"
              accessibilityLabel="Previous onboarding page"
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <Ionicons name="arrow-back" size={21} color="#245C36" />
            </Pressable>
          )}
        </View>
        <View style={styles.brand}>
          <Ionicons name="leaf" size={18} color="#278448" />
          <Text style={styles.brandText}>LeafCheck</Text>
        </View>
        <View style={styles.backSlot} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.artwork, { width: artworkSize, height: artworkSize }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.artworkRing} />
          <View style={styles.artworkInner}>
            {currentSlide === 0 ? (
              <Image source={require("@/assets/images/leafcheck-logo.png")} style={styles.logo} resizeMode="contain" />
            ) : (
              <Ionicons name={slide.icon} size={artworkSize * 0.34} color="#278448" />
            )}
          </View>
          <View style={styles.sparkle}><Ionicons name="sparkles" size={22} color="#278448" /></View>
          <View style={styles.leafBadge}><Ionicons name="leaf" size={25} color="#FFFFFF" /></View>
        </View>

        <Text style={[styles.caption, compact && styles.compactCaption]}>{slide.caption}</Text>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
          {/* All copy participates in layout so the longest title/description
              reserves the same space on every page, including at large font sizes. */}
          <View style={styles.textSlot}>
            {slides.map((item) => (
              <Text key={item.eyebrow} style={[styles.title, styles.measuringText]}
                accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {item.title}
              </Text>
            ))}
            <View style={styles.visibleText} pointerEvents="none">
              <Text accessibilityRole="header" style={styles.title}>{slide.title}</Text>
            </View>
          </View>
          <View style={styles.descriptionSlot}>
            {slides.map((item) => (
              <Text key={item.eyebrow} style={[styles.description, styles.measuringText]}
                accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {item.description}
              </Text>
            ))}
            <View style={styles.visibleText} pointerEvents="none">
              <Text style={styles.description}>{slide.description}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.dotsContainer} accessible accessibilityLabel={`Page ${currentSlide + 1} of ${slides.length}`}>
          {slides.map((item, index) => (
            <View key={item.eyebrow} style={[styles.dot, index === currentSlide && styles.activeDot]} />
          ))}
        </View>
        <Pressable onPress={nextAction} accessibilityRole="button"
          style={({ pressed }) => [styles.ctaButton, pressed && styles.pressed]}>
          <Text style={styles.ctaButtonText}>{currentSlide === 2 ? "Letâ€™s get growing" : "Next"}</Text>
          <Ionicons name="arrow-forward" size={21} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FBF7" },
  header: { width: "100%", maxWidth: 480, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  backSlot: { width: 44, height: 44 },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#EAF2E8", alignItems: "center", justifyContent: "center" },
  brand: { flexDirection: "row", alignItems: "center", gap: 7 },
  brandText: { fontSize: 18, fontWeight: "700", color: "#245C36", letterSpacing: -0.5 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingVertical: 20 },
  artwork: { alignItems: "center", justifyContent: "center", borderRadius: 180, backgroundColor: "#E8F2E4" },
  artworkRing: { position: "absolute", width: "88%", height: "88%", borderRadius: 160, borderWidth: 1, borderColor: "#C8DEC4" },
  artworkInner: { width: "72%", height: "72%", borderRadius: 120, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  logo: { width: "80%", height: "80%" },
  sparkle: { position: "absolute", right: "4%", top: "12%", width: 44, height: 44, borderRadius: 22, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  leafBadge: { position: "absolute", left: "6%", bottom: "7%", width: 52, height: 52, borderRadius: 26, backgroundColor: "#278448", alignItems: "center", justifyContent: "center", borderWidth: 5, borderColor: "#F8FBF7" },
  caption: { fontSize: 12, lineHeight: 18, color: "#6B806F", textAlign: "center", marginTop: 18, marginBottom: 30 },
  compactCaption: { marginTop: 12, marginBottom: 20 },
  copy: { width: "100%", maxWidth: 360, alignItems: "center" },
  eyebrow: { color: "#278448", fontSize: 11, lineHeight: 16, letterSpacing: 2.5, fontWeight: "700", marginBottom: 12 },
  textSlot: { width: "100%", flexDirection: "row", flexWrap: "wrap" },
  descriptionSlot: { width: "100%", flexDirection: "row", flexWrap: "wrap", marginTop: 14 },
  measuringText: { opacity: 0, width: "100%", marginRight: "-100%" },
  visibleText: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  title: { fontSize: 30, lineHeight: 37, fontWeight: "800", letterSpacing: -0.8, color: "#193E27", textAlign: "center" },
  description: { fontSize: 16, lineHeight: 25, color: "#66746A", textAlign: "center" },
  footer: { flexShrink: 0, width: "100%", maxWidth: 360, alignSelf: "center", paddingTop: 16 },
  dotsContainer: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, height: 12, marginBottom: 22 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#CDDDCD" },
  activeDot: { width: 24, backgroundColor: "#278448" },
  ctaButton: { minHeight: 52, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 26, backgroundColor: "#278448", flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12 },
  ctaButtonText: { flexShrink: 1, textAlign: "center", fontSize: 16, lineHeight: 24, fontWeight: "700", color: "#FFFFFF" },
  pressed: { opacity: 0.75 },
});

