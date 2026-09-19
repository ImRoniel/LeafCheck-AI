import { Image, StyleSheet } from "react-native";

export function LeafCheckLogo({ size = 120 }: { size?: number }) {
  return (
    <Image
      source={require("@/assets/images/leafcheck-logo.png")}
      style={[styles.logo, { width: size, height: size }]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    borderRadius: 8,
  },
});
