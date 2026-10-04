import { forwardRef, useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, type PressableProps, type View } from "react-native";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const NativePressable = Animated.createAnimatedComponent(Pressable);

/** Subtle press feedback without changing layout, action timing, or the native view ref. */
export const AnimatedPressable = forwardRef<View, PressableProps>(function AnimatedPressable({
  style, onPressIn, onPressOut, onHoverIn, onHoverOut, disabled, ...props
}, ref) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const useNativeDriver = Platform.OS !== "web";

  useEffect(() => {
    if (reduced || disabled) {
      animation.current?.stop();
      scale.setValue(1);
      setPressed(false);
    }
    return () => animation.current?.stop();
  }, [disabled, reduced, scale]);

  const pressState = { pressed, hovered };
  const currentStyle = typeof style === "function" ? style(pressState) : style;
  const existingTransform = StyleSheet.flatten(currentStyle)?.transform;
  const feedbackStyle = typeof existingTransform === "string" ? undefined : {
    transform: [...(existingTransform ?? []), { scale }],
  };
  const webAccessibility = Platform.OS === "web" ? {
    "aria-busy": props["aria-busy"] ?? props.accessibilityState?.busy,
    "aria-checked": props["aria-checked"] ?? props.accessibilityState?.checked,
    "aria-disabled": props["aria-disabled"] ?? props.accessibilityState?.disabled,
    "aria-expanded": props["aria-expanded"] ?? props.accessibilityState?.expanded,
    "aria-selected": props["aria-selected"] ?? props.accessibilityState?.selected,
  } : {};
  return <NativePressable {...props} {...webAccessibility} ref={ref} disabled={disabled}
    style={[currentStyle, feedbackStyle]}
    onHoverIn={event => { setHovered(true); onHoverIn?.(event); }}
    onHoverOut={event => { setHovered(false); onHoverOut?.(event); }}
    onPressIn={event => {
      if (!disabled) {
        setPressed(true);
        if (!reduced) {
          animation.current?.stop();
          animation.current = Animated.timing(scale, { toValue: 0.97, duration: 85, useNativeDriver, isInteraction: false });
          animation.current.start();
        }
      }
      onPressIn?.(event);
    }}
    onPressOut={event => {
      setPressed(false);
      animation.current?.stop();
      if (!reduced && !disabled) {
        animation.current = Animated.spring(scale, { toValue: 1, damping: 24, stiffness: 330, mass: 0.7, useNativeDriver, isInteraction: false });
        animation.current.start();
      } else scale.setValue(1);
      onPressOut?.(event);
    }} />;
});
