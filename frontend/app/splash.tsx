import { LeafCheckLogo } from "@/components/leaf-check-logo";
import { useInstallOnboarding } from "@/context/install-onboarding";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

export default function Splash() {
  const intro = useInstallOnboarding();

  useEffect(() => {
    if (intro.phase !== "splash") return;
    // Begin intro only after the installation marker has loaded.
    const timer = setTimeout(() => {
      intro.finishSplash();
    }, 2000);

    return () => clearTimeout(timer);
  }, [intro.phase, intro.finishSplash]);

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
