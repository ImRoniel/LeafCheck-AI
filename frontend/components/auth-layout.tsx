import { LeafCheckLogo } from "@/components/leaf-check-logo";
import { Ionicons } from "@expo/vector-icons";
import { PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function AuthLayout({ children, title, description, onBack, recovery = false, compact = false }: PropsWithChildren<{
  title: string;
  description: string;
  onBack?: () => void;
  recovery?: boolean;
  compact?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 28, paddingLeft: insets.left + 24, paddingRight: insets.right + 24 }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.backSlot}>{onBack && (
            <Pressable onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to log in">
              <Ionicons name="arrow-back" size={21} color="#245C36" />
            </Pressable>
          )}</View>
          <View style={styles.brand}><Ionicons name="leaf" size={18} color="#278448" /><Text style={styles.brandText}>LeafCheck</Text></View>
          <View style={styles.backSlot} />
        </View>
        <View style={[styles.body, compact && styles.compactBody]}>
          <View style={[styles.artwork, compact && styles.compactArtwork]}>
            {recovery ? <Ionicons name="lock-closed-outline" size={48} color="#278448" /> : <LeafCheckLogo size={compact ? 80 : 110} />}
          </View>
          <Text style={styles.eyebrow}>{recovery ? "LETâ€™S GET YOU BACK" : "GROW WITH CONFIDENCE"}</Text>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>
          <View style={styles.form}>{children}</View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export const authStyles = StyleSheet.create({
  link: { color: "#278448", fontWeight: "700", fontSize: 14, lineHeight: 22 },
  linkButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  footer: { marginTop: 20, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 4 },
  footerText: { color: "#66746A", fontSize: 14, lineHeight: 22 },
  recoveryLink: { alignSelf: "flex-end", minHeight: 44, justifyContent: "center", marginTop: -8, marginBottom: 14, paddingHorizontal: 4 },
  note: { color: "#66746A", fontSize: 13, lineHeight: 20, textAlign: "center", marginBottom: 20 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FBF7" },
  scroll: { flexGrow: 1 },
  header: { width: "100%", maxWidth: 440, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  backSlot: { width: 44, height: 44 },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#EAF2E8", alignItems: "center", justifyContent: "center" },
  brand: { flexDirection: "row", alignItems: "center", gap: 7 },
  brandText: { fontSize: 18, fontWeight: "700", color: "#245C36", letterSpacing: -0.5 },
  body: { flexGrow: 1, justifyContent: "center", alignItems: "center", width: "100%", maxWidth: 400, alignSelf: "center", paddingVertical: 24 },
  compactBody: { paddingVertical: 12 },
  artwork: { width: 140, height: 140, borderRadius: 70, backgroundColor: "#E8F2E4", alignItems: "center", justifyContent: "center", marginBottom: 24 },
  compactArtwork: { width: 100, height: 100, borderRadius: 50, marginBottom: 18 },
  eyebrow: { fontSize: 10, lineHeight: 16, fontWeight: "700", letterSpacing: 2, color: "#278448", textAlign: "center", marginBottom: 8 },
  title: { fontSize: 32, lineHeight: 40, fontWeight: "800", letterSpacing: -0.8, color: "#193E27", textAlign: "center" },
  description: { fontSize: 15, lineHeight: 23, color: "#66746A", textAlign: "center", marginTop: 8, marginBottom: 28, maxWidth: 340 },
  form: { width: "100%" },
});

