import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

/** Stop mock work on navigation blur and on native app backgrounding. */
export function useDeviceActivity() {
  // Use the same navigation implementation as the Expo Router stack.
  const focused = useIsFocused();
  const [visible, setVisible] = useState(true);
  const [foreground, setForeground] = useState(
    AppState.currentState !== "background" &&
      AppState.currentState !== "inactive",
  );
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return focused && foreground && visible;
}
