import { StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";
import { useRef } from "react";
import { AnimatedPressable as Pressable } from "./animated-pressable";
export type SpaceMenuAnchor = { x: number; y: number; width: number; height: number };
export function SpaceMenuButton({ label, onPress, onOpen, style }: {
  label: string; onPress?: (event: GestureResponderEvent) => void;
  onOpen?: (anchor: SpaceMenuAnchor) => void; style?: StyleProp<ViewStyle>;
  variant?: "card" | "detail" | "plant";
}) {
  const dots = useRef<View>(null);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={event => {
    event.stopPropagation();
    if (onOpen) dots.current?.measureInWindow((x, y, width, height) => onOpen({ x, y, width, height }));
    else onPress?.(event);
  }} style={[styles.button, style]}>
    <View ref={dots} collapsable={false} pointerEvents="none" style={styles.dots}>
      <View style={styles.dot} /><View style={[styles.dot, styles.middle]} /><View style={styles.dot} />
    </View>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { width: 44, height: 44, justifyContent: "center", alignItems: "center" },
  dots: { width: 21, height: 5, flexDirection: "row", justifyContent: "space-between" },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: "#34C759" },
  middle: { backgroundColor: "#009951" },
});
