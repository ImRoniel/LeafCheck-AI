import { useProfile } from "@/context/profile";
import { ProfileButton } from "./profile-button";
import { StyleSheet, Text, View } from "react-native";
export function GreetingHeader({ plantCount, ready, now }: { plantCount: number; ready: boolean; now: Date }) {
  const profile = useProfile();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = profile.name.trim().split(/\s+/)[0];
  return <View style={s.header}>
    <View style={s.text}><Text accessibilityRole="header" style={s.greeting}>{greeting}{name ? `, ${name}` : ""}</Text>
      <Text style={s.subtitle}>{now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} · {ready ? `${plantCount} ${plantCount === 1 ? "plant" : "plants"}` : "Loading garden…"}</Text>
    </View><ProfileButton />
  </View>;
}
const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 20, paddingHorizontal: 18, backgroundColor: "#1A4D2E", borderRadius: 24, boxShadow: "0px 5px 16px rgba(26,77,46,0.16)" }, text: { flex: 1, minWidth: 0, gap: 6 },
  greeting: { fontSize: 26, lineHeight: 33, fontWeight: "800", color: "#FFFFFF" }, subtitle: { fontSize: 13, lineHeight: 20, color: "rgba(230,246,230,0.88)" },
});
