import { BottomNav } from "@/components/bottom-nav";
import { Tabs } from "expo-router";
export default function Layout() {
  return (
    <Tabs
      tabBar={(props) =>
        ["scanner", "camera"].includes(
          props.state.routes[props.state.index]?.name ?? "",
        ) ? null : (
          <BottomNav {...props} />
        )
      }
      backBehavior="history"
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="garden" options={{ title: "My Garden" }} />
      <Tabs.Screen name="tasks" options={{ title: "Care Tasks" }} />
      <Tabs.Screen
        name="scanner"
        options={{ title: "Scan Plant", href: null }}
      />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="spaces" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="camera" options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="space-detail" options={{ href: null }} />
    </Tabs>
  );
}
