import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

export function ProfilePhotoToast() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4_000);
    return () => clearTimeout(timer);
  }, []);
  return visible ? (
    <View style={styles.toast} accessibilityLiveRegion="polite">
      <Text style={styles.text}>Profile photo could not be saved.</Text>
    </View>
  ) : null;
}
const styles = StyleSheet.create({
  toast: { backgroundColor: "#333D35", padding: 12, borderRadius: 10, marginBottom: 12 },
  text: { color: "#FFFFFF", fontSize: 13 },
});
