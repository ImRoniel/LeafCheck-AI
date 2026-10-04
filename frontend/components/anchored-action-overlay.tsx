import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { Animated, BackHandler, Platform, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useIsFocused } from "expo-router";
import { actionMenuPosition } from "./action-menu-style";
import type { SpaceMenuAnchor } from "./space-menu-button";

/** Render in the screen's own native view hierarchy, never a different Modal window. */
export function AnchoredActionOverlay({ visible, anchor, menuHeight = 67, menuWidth = 75, placement: side = "below", closeLabel, onClose, children }: PropsWithChildren<{
  visible: boolean; anchor?: SpaceMenuAnchor; menuHeight?: number; menuWidth?: number;
  placement?: "below" | "left";
  closeLabel: string; onClose: () => void;
}>) {
  const root = useRef<View>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(visible);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [contentHeight, setContentHeight] = useState(menuHeight);
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const close = useRef(onClose);
  close.current = onClose;
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    if (!focused && visible) close.current();
  }, [focused, visible]);
  useEffect(() => {
    if (visible) setRendered(true);
  }, [visible]);
  useEffect(() => {
    if (!visible || !focused || Platform.OS === "web") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => subscription.remove();
  }, [visible, focused, onClose]);
  useEffect(() => {
    if (visible && !origin) return;
    let active = true;
    const animation = visible && !reduceMotion
      ? Animated.spring(opacity, { toValue: 1, damping: 18, stiffness: 220, mass: 0.7, useNativeDriver: Platform.OS !== "web" })
      : Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: reduceMotion ? 0 : 120, useNativeDriver: Platform.OS !== "web" });
    animation.start(({ finished }) => {
      if (active && finished && !visible) { setRendered(false); setOrigin(null); }
    });
    return () => { active = false; animation.stop(); };
  }, [visible, origin, opacity, reduceMotion]);

  if (!focused || !rendered || !anchor) return null;
  const placement = actionMenuPosition(anchor, width, height, contentHeight, side, menuWidth);
  const measureRoot = () => root.current?.measureInWindow((x, y) => setOrigin({ x, y }));
  const measureMenu = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    if (measured > 0 && Math.abs(measured - contentHeight) > 0.5) setContentHeight(measured);
  };
  return <View ref={root} collapsable={false} onLayout={measureRoot} style={styles.root} pointerEvents={visible ? "auto" : "none"} accessibilityViewIsModal={visible}>
    <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} style={StyleSheet.absoluteFill} />
    <Animated.View onLayout={measureMenu} style={{ position: "absolute", width: placement.width,
      left: placement.left - (origin?.x ?? 0), top: placement.top - (origin?.y ?? 0),
      maxHeight: Math.max(32, height - placement.top - 16),
      opacity: origin ? opacity.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }) : 0,
      transformOrigin: side === "left" ? "right center" : "right top",
      transform: reduceMotion ? [] : [
        { scale: opacity.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
        { translateY: opacity.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) },
      ] }}>
      {children}
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({ root: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 } });
