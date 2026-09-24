import {
    NavigationContainerRefContext,
    NavigationContext,
} from "@react-navigation/native";
import { useCallback, useContext, useSyncExternalStore } from "react";

type FocusNavigation = {
  isFocused(): boolean;
  addListener(event: "focus" | "blur", callback: () => void): () => void;
};

/** Follow screen focus when available; standalone resources stay active. */
export function useOptionalIsFocused(): boolean {
  const screen = useContext(NavigationContext);
  const root = useContext(NavigationContainerRefContext);
  // React Navigation's focus hook also treats the root fallback as screen navigation.
  const navigation = (screen ?? root) as FocusNavigation | undefined;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation) return () => {};

      const unsubscribeFocus = navigation.addListener("focus", onChange);
      const unsubscribeBlur = navigation.addListener("blur", onChange);
      return () => {
        unsubscribeFocus();
        unsubscribeBlur();
      };
    },
    [navigation],
  );
  const getSnapshot = useCallback(
    () => navigation?.isFocused() ?? true,
    [navigation],
  );

  // Always call the same hooks, even if a navigation provider appears/disappears.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
