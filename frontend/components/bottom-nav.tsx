import { AnimatedPressable } from "@/components/animated-pressable";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { useEffect, useRef, type ComponentProps } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type BottomTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

const items = [
  { name: "index", label: "Home", icon: "home-outline", activeIcon: "home" },
  { name: "spaces", label: "My Spaces", icon: "leaf-outline", activeIcon: "leaf" },
  { name: "tasks", label: "Care Tasks", icon: "calendar-outline", activeIcon: "calendar" },
] as const;

const isSelected = (name: string, activeName: string | undefined) =>
  activeName === name ||
  (name === "spaces" && ["space-detail", "garden"].includes(activeName ?? ""));

export function BottomNav({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const activeName = state.routes[state.index]?.name;
  const selection = useRef(items.map(item =>
    new Animated.Value(isSelected(item.name, activeName) ? 1 : 0),
  )).current;
  useEffect(() => {
    // Reduced motion uses static styles; effect cleanup stops any running animation.
    if (reducedMotion) return;
    const animation = Animated.parallel(selection.map((value, index) =>
      Animated.timing(value, {
        toValue: isSelected(items[index].name, activeName) ? 1 : 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
        isInteraction: false,
      }),
    ));
    animation.start();
    return () => animation.stop();
  }, [activeName, reducedMotion, selection]);
  const renderItem = (item: (typeof items)[number], index: number) => {
    const route = state.routes.find((route) => route.name === item.name);
    const active = state.routes[state.index];
    const selected = isSelected(item.name, active?.name);
    const color = selected ? "#1B6B36" : "#506557";
    return (
      <AnimatedPressable
        key={item.name}
        accessibilityRole="tab"
        accessibilityLabel={item.label}
        accessibilityState={{ selected }}
        style={s.item}
        onPress={() => {
          if (!route) return;
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (active?.key !== route.key && !event.defaultPrevented)
            navigation.navigate(route.name);
        }}
        onLongPress={() => {
          if (route)
            navigation.emit({ type: "tabLongPress", target: route.key });
        }}
      >
        <Animated.View pointerEvents="none" style={{
            transform: [{ scale: reducedMotion ? 1 : selection[index].interpolate({
              inputRange: [0, 1], outputRange: [1, 1.04],
            }) }],
          }}>
          {/* Expo icons do not expose a compatible native animation ref. */}
          <Ionicons name={selected ? item.activeIcon : item.icon} size={24}
            color={selected ? "#1B6B36" : "#506557"} />
        </Animated.View>
        <Text style={[s.label, selected && s.selected, { color }]}>{item.label}</Text>
      </AnimatedPressable>
    );
  };
  const horizontalInset = Math.max(8, insets.left || 0, insets.right || 0);
  return (
    <View
      pointerEvents="box-none"
      style={[
        s.outer,
        {
          bottom: Math.max(25, insets.bottom + 12),
          left: horizontalInset,
          right: horizontalInset,
        },
      ]}
    >
      <View pointerEvents="box-none" style={s.dock}>
        <View style={s.bar}>{items.map(renderItem)}</View>
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel="Scan Plant"
          accessibilityHint="Open the camera to identify or scan a plant"
          style={({ pressed }) => [s.scan, pressed && s.scanPressed]}
          onPress={() => router.navigate("/(tabs)/scanner")}
        >
          <Ionicons name="camera-outline" size={26} color="#FFFFFF" />
        </AnimatedPressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: { position: "absolute", alignItems: "center" },
  dock: {
    flexDirection: "row",
    alignItems: "center",
    width: 303,
    maxWidth: "100%",
    gap: 10,
  },
  bar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 58,
    borderRadius: 29,
    backgroundColor: "#FFFFFF",
    paddingVertical: 4,
    shadowColor: "#193E27",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  item: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    paddingHorizontal: 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  label: {
    fontSize: 11,
    color: "#506557",
    textAlign: "center",
    width: "100%",
    fontWeight: "600",
  },
  selected: { color: "#1B6B36", fontWeight: "800" },
  scan: {
    width: 58,
    height: 58,
    flexShrink: 0,
    borderRadius: 29,
    backgroundColor: "#278448",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#193E27",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  scanPressed: { backgroundColor: "#1B6B36" },
});
