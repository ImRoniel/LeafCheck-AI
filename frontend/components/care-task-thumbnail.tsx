import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";

export function CareTaskThumbnail({ uri, name }: { uri?: string; name: string }) {
  const [failedUri, setFailedUri] = useState<string>();
  return <View style={styles.frame}>
    {uri && failedUri !== uri
      ? <Image source={{ uri }} accessibilityLabel={`${name} photo`} style={styles.image} resizeMode="cover" onError={() => setFailedUri(uri)} />
      : <View accessibilityLabel={`${name}: no plant photo`} style={styles.placeholder}><Ionicons name="leaf-outline" size={30} color="#278448" /></View>}
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: 64, height: 76, flexShrink: 0, padding: 4, borderRadius: 18, backgroundColor: "#E6F5E4" },
  image: { width: "100%", height: "100%", borderRadius: 14 },
  placeholder: { flex: 1, borderRadius: 14, backgroundColor: "#F2F8F0", alignItems: "center", justifyContent: "center" },
});
