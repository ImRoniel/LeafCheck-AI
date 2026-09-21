import { useAuth } from "@/context/auth";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export function GreetingHeader() {
  const router = useRouter();
  const auth = useAuth();
  const profile = {
    name: auth.user?.name || (auth.isGuest ? "Guest" : "Plant lover"),
    photoUri: undefined as string | undefined,
  };
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
      <TouchableOpacity
        style={styles.profileIcon}
        onPress={() => router.replace("/profile")}
        accessibilityRole="button"
        accessibilityLabel="Open profile"
      >
        {profile.photoUri ? (
          <Image
            source={{ uri: profile.photoUri }}
            style={styles.profileImage}
          />
        ) : (
          <Ionicons name="person-outline" size={25} color="#20A64A" />
        )}
      </TouchableOpacity>
      <View style={styles.modePill}>
        <Text style={styles.modeText}>
          {auth.isGuest ? "Guest • Local only" : "Private collection"}
        </Text>
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
    marginBottom: 18,
    minHeight: 72,
  },
  greetingContainer: {
    flex: 1,
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
  profileIcon: {
    width: 38,
    height: 38,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 2,
  },
  profileImage: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  modePill: {
    position: "absolute",
    right: 0,
    bottom: -10,
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
});
