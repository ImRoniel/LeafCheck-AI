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
      style={[
        s.outer,
        {
          bottom: insets.bottom + 12,
          left: horizontalInset,
          right: horizontalInset,
        },
      ]}
    >
      <View style={s.bar}>
        <View style={s.side}>{items.slice(0, 2).map(renderItem)}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan Plant"
          accessibilityHint="Open the camera to identify or scan a plant"
          style={s.scan}
          onPress={() => router.navigate("/(tabs)/scanner")}
        >
          <Ionicons name="camera-outline" size={26} color="#FFFFFF" />
          <Text style={s.scanLabel}>Scan</Text>
        </Pressable>
        <View style={s.side}>{items.slice(2).map(renderItem)}</View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: { position: "absolute", left: 12, right: 12, alignItems: "center" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 560,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  side: { flex: 1, flexBasis: 0, flexDirection: "row", alignItems: "center" },
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
    flexShrink: 0,
    marginHorizontal: 8,
    minHeight: 60,
    marginTop: -24,
    borderRadius: 30,
    backgroundColor: "#1B6B36",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  scanLabel: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
});
