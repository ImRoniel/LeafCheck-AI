import { useFonts } from "expo-font";
import { StyleSheet } from "react-native";
import type { SpaceMenuAnchor } from "./space-menu-button";

export function useActionMenuFont() {
  const [loaded] = useFonts({ "Inter-SemiBold": require("../assets/fonts/Inter-SemiBold.ttf") });
  return loaded ? "Inter-SemiBold" : undefined;
}

/** Anchor coordinates describe the visible dots, not their larger invisible touch target. */
export function actionMenuPosition(anchor: SpaceMenuAnchor | undefined, width: number, height: number, menuHeight = 67, placement: "below" | "left" = "below", preferredWidth = 75) {
  const availableWidth = placement === "left" && anchor ? anchor.x - 26 : width - 32;
  const menuWidth = Math.min(preferredWidth, Math.max(0, availableWidth));
  if (placement === "left" && anchor) return {
    width: menuWidth,
    top: Math.max(16, Math.min(anchor.y + (anchor.height - menuHeight) / 2, height - menuHeight - 16)),
    left: Math.max(16, Math.min(anchor.x - menuWidth - 10, width - menuWidth - 16)),
  };
  const below = anchor ? anchor.y + anchor.height + 10 : 0;
  return {
    width: menuWidth,
    top: below + menuHeight <= height - 16 ? below : Math.max(16, (anchor?.y ?? 0) - menuHeight - 10),
    left: Math.max(16, Math.min((anchor?.x ?? 0) + (anchor?.width ?? 30) + 2 - menuWidth, width - menuWidth - 16)),
  };
}

export const actionMenuStyles = StyleSheet.create({
  button: { width: "100%", minHeight: 32, borderRadius: 50, borderWidth: 1, borderColor: "#E9E9E9", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", paddingTop: 6, paddingBottom: 5 },
  label: { fontSize: 14, fontWeight: "600", letterSpacing: 0, lineHeight: 19, textAlign: "center", includeFontPadding: false },
});
