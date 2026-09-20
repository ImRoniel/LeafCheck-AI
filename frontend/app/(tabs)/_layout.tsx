import { BottomNav } from "@/components/bottom-nav";
import { Tabs } from "expo-router";
export default function Layout() {
  return (
    <Tabs
      tabBar={(props) => <BottomNav {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="spaces" />
      <Tabs.Screen name="notifications" />
      <Tabs.Screen name="camera" />
      <Tabs.Screen name="space-detail" options={{ href: null }} />
    </Tabs>
  );
}
