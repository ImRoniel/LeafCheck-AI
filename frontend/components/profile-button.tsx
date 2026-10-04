import { useProfile } from "@/context/profile";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Image, StyleSheet } from "react-native";
import { AnimatedPressable } from "./animated-pressable";

export function ProfileButton() {
  const router = useRouter();
  const profile = useProfile();
  return (
    <AnimatedPressable style={styles.button} onPress={() => router.push("/profile")}
      accessibilityRole="button" accessibilityLabel="Open profile">
      {profile.photoUri ? <Image source={{ uri: profile.photoUri }} style={styles.image} /> :
        <Ionicons name="person-outline" size={25} color="#20A64A" />}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 38, height: 38, borderRadius: 20, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "center", marginRight: 2 },
  image: { width: 38, height: 38, borderRadius: 19 },
});
