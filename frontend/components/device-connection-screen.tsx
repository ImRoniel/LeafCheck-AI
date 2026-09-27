import { Action, ui } from "@/components/screen";
import { useRouter } from "expo-router";
import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function DeviceConnectionScreen({
  title,
  step,
  children,
  onCancel,
}: PropsWithChildren<{
  title: string;
  step: number;
  onCancel?: () => void;
}>) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <Text style={styles.eyebrow}>CONNECT DEVICE · {step} OF 4</Text>
      <Text accessibilityRole="header" style={ui.title}>
        {title}
      </Text>
      <Text style={styles.disclaimer}>
        Mock setup only. No physical hardware is discovered or connected, and no
        live readings are enabled.
      </Text>
      <View style={styles.body}>{children}</View>
      {step !== 4 && (
        <Action
          label="Cancel"
          onPress={() => {
            onCancel?.();
            router.dismissTo("/(tabs)");
          }}
        />
      )}
    </View>
  );
}

export const deviceStyles = StyleSheet.create({
  content: { paddingVertical: 12, gap: 16, flexGrow: 1 },
  center: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    paddingVertical: 24,
  },
  text: { color: "#193E27", fontSize: 16, lineHeight: 24 },
  status: {
    color: "#193E27",
    backgroundColor: "#E8F2E8",
    padding: 16,
    borderRadius: 16,
    lineHeight: 23,
  },
  node: {
    padding: 20,
    minHeight: 80,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#B3C8B7",
    backgroundColor: "#FFFFFF",
    gap: 8,
  },
  selected: {
    borderColor: "#193E27",
    borderWidth: 2,
    backgroundColor: "#E8F2E8",
  },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F8FBF7",
    paddingHorizontal: 22,
    gap: 12,
  },
  eyebrow: { color: "#193E27", fontWeight: "700", letterSpacing: 1 },
  disclaimer: { color: "#193E27", fontSize: 14, lineHeight: 20 },
  body: { flex: 1 },
});
