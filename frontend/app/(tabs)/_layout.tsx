import { BottomNav } from "@/components/bottom-nav";
import { Tabs } from "expo-router";

export default function Layout() {
  return (
    <Tabs
      initialRouteName="index"
      // BottomNav owns the three-tab pill and separate right-hand camera FAB.
      // Keep both hidden while the scanner or legacy camera route is active.
      tabBar={(props) =>
        ["scanner", "camera"].includes(
          props.state.routes[props.state.index]?.name ?? "",
        ) ? null : (
          <BottomNav {...props} />
        )
      }
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: "#FFFFFF", overflow: "hidden" },
        animation: "none",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", lazy: false }} />
      <Tabs.Screen name="spaces" options={{ title: "My Spaces", lazy: false }} />
      <Tabs.Screen name="tasks" options={{ title: "Care Tasks", lazy: false }} />
      <Tabs.Screen
        name="scanner"
        options={{ title: "Scan Plant", href: null }}
      />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="garden" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="camera" options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="space-detail" options={{ href: null }} />
    </Tabs>
  );
}
