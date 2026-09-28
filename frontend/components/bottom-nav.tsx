import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type BottomTabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

const items = [
  { name: "index", label: "Home", icon: "home-outline" },
  { name: "garden", label: "My Garden", icon: "leaf-outline" },
  { name: "tasks", label: "Care Tasks", icon: "checkbox-outline" },
] as const;

export function BottomNav({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const renderItem = (item: (typeof items)[number]) => {
    const route = state.routes.find((route) => route.name === item.name);
    const active = state.routes[state.index];
    const selected =
      active?.name === item.name ||
      (item.name === "garden" && active?.name === "space-detail");
    return (
      <Pressable
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
        <Ionicons
          name={item.icon}
          size={23}
          color={selected ? "#1B6B36" : "#506557"}
        />
        <Text style={[s.label, selected && s.selected]}>{item.label}</Text>
      </Pressable>
    );
  };
  const horizontalInset = Math.max(12, insets.left || 0, insets.right || 0);
  return (
    <View
      pointerEvents="box-none"
      style={[
        s.outer,
        {
          bottom: insets.bottom + 12,
          left: horizontalInset,
          right: horizontalInset,
        },
      ]}
    >
      <View pointerEvents="box-none" style={s.dock}>
        <View style={s.bar}>{items.map(renderItem)}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan Plant"
          accessibilityHint="Open the camera to identify or scan a plant"
          style={({ pressed }) => [s.scan, pressed && s.scanPressed]}
          onPress={() => router.navigate("/(tabs)/scanner")}
        >
          <Ionicons name="camera-outline" size={26} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: { position: "absolute", left: 12, right: 12, alignItems: "center" },
  dock: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 560,
    gap: 12,
  },
  bar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "#E2EBE4",
    backgroundColor: "#FFFFFF",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  item: {
    flex: 1,
    minWidth: 48,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  label: {
    fontSize: 11,
    color: "#506557",
    textAlign: "center",
    fontWeight: "600",
  },
  selected: { color: "#1B6B36", fontWeight: "800" },
  scan: {
    width: 60,
    height: 60,
    flexShrink: 0,
    borderRadius: 30,
    backgroundColor: "#1B6B36",
    alignItems: "center",
    justifyContent: "center",
  },
  scanPressed: { backgroundColor: "#145329" },
});
