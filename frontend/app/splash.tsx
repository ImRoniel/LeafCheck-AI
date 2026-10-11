import { LeafCheckLogo } from "@/components/leaf-check-logo";
import { StyleSheet, View } from "react-native";

export default function Splash() {
  return (
    <View style={styles.container}>
      <LeafCheckLogo size={300} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
});
