import { useAuth } from "@/context/auth";
import { useProfile } from "@/context/profile";
import { ProfileButton } from "./profile-button";
import { StyleSheet, Text, View } from "react-native";

export function GreetingHeader({
  mockConnected = false,
}: {
  mockConnected?: boolean;
}) {
  const auth = useAuth();
  const profile = useProfile();
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <View style={styles.container}>
      <View style={styles.greetingContainer}>
        <Text style={styles.greeting}>
          Hello, {profile.name.trim().split(/\s+/)[0] || "User"} &
        </Text>
        <Text style={styles.greetingAccent}>
          {getGreeting().replace("!", "")}
          <Text style={styles.greetingExclamation}>!</Text>
        </Text>
        <Text style={styles.date}>{date}</Text>
      </View>
      <View style={styles.rightColumn}>
        <ProfileButton />
        <View style={[styles.modePill, mockConnected && styles.autoPill]}>
          <Text style={styles.modeText}>
            {mockConnected
              ? "Mode: Auto (With IoT)"
              : auth.isGuest
                ? "Local session"
                : "Private collection"}
          </Text>
        </View>
        {mockConnected && (
          <Text style={styles.mockLabel}>
            Mock setup · No live connection
            {auth.isGuest ? "\nLocal session" : ""}
          </Text>
        )}
      </View>
    </View>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning!";
  if (hour < 18) return "Good Afternoon!";
  return "Good Evening!";
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 18,
    minHeight: 72,
  },
  greetingContainer: {
    flex: 1,
    minWidth: 160,
  },
  greeting: {
    fontSize: 25,
    fontWeight: "400",
    color: "#FFFFFF",
  },
  greetingAccent: {
    fontSize: 25,
    fontWeight: "400",
    color: "#2DBB55",
  },
  greetingExclamation: {
    color: "#FFFFFF",
  },
  date: {
    fontSize: 13,
    color: "#FFFFFF",
    marginTop: 1,
  },
  modePill: {
    backgroundColor: "#F5B800",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  modeText: {
    fontSize: 9,
    fontWeight: "600",
    color: "#111111",
  },
  rightColumn: {
    alignItems: "flex-end",
    gap: 8,
    maxWidth: "100%",
    marginLeft: "auto",
  },
  autoPill: { backgroundColor: "#FFFFFF" },
  mockLabel: {
    color: "#FFFFFF",
    fontSize: 11,
    textAlign: "right",
    maxWidth: 170,
  },
});
