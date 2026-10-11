import type { PropsWithChildren } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export function TaskSheet({ title, onClose, children }: PropsWithChildren<{ title: string; onClose: () => void }>) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  return <Modal visible transparent animationType={reducedMotion ? "none" : "slide"} onRequestClose={onClose} statusBarTranslucent>
    <View style={s.overlay}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sheet" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View accessibilityViewIsModal style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={s.header}><Text accessibilityRole="header" style={s.title}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close sheet" onPress={onClose} style={s.close}><Text style={s.closeText}>✕</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={s.content}>{children}</ScrollView>
      </View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(9,29,21,0.4)" },
  sheet: { maxHeight: "85%", backgroundColor: "#FFFFFF", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  title: { flex: 1, fontSize: 21, fontWeight: "700", color: "#193E27" },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }, closeText: { fontSize: 20, color: "#506557" },
  content: { gap: 16, paddingBottom: 12 },
});
