import { AuthButton } from "@/components/auth-button";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

export default function Terms() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);

  const handleAccept = () => {
    router.replace("/login");
  };

  const handleDeny = () => {
    router.push("/register");
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <View style={styles.container}>
      {/* Back arrow */}
      <TouchableOpacity onPress={handleBack} style={styles.backButton}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>

      {/* Title */}
      <Text style={styles.title}>Terms and Conditions</Text>

      {/* Terms content */}
      <ScrollView style={styles.termsContent}>
        <Text style={styles.termsText}>
          Welcome to LeafCheck! By using our app, you agree to the following
          terms: 1. Plant Identification We use AI-powered computer vision to
          identify plant species and detect health issues. While we strive for
          accuracy, results are for informational purposes only. 2. IoT Sensor
          Data Our app integrates with IoT sensors to monitor environmental
          conditions including soil moisture, humidity, temperature, and ambient
          light in lux. Soil pH is not a live measurement. 3. Availability
          Account services and augmented reality are not available in this build.
          4. Data Privacy This guest build is for local integration testing only.
          The current API is not authenticated or user-scoped. Do not expose it
          publicly or submit sensitive information. Images are sent to external
          identification and analysis providers through the backend.
          5. User Responsibilities You are responsible for
          maintaining your plants and following care recommendations. LeafCheck
          is not liable for plant damage or loss. 6. Updates We may update these
          terms periodically. Continued use of the app constitutes acceptance of
          any changes.
        </Text>
      </ScrollView>

      {/* Accept/Deny Buttons */}
      <View style={styles.buttonContainer}>
        <AuthButton
          title="Accept"
          onPress={handleAccept}
          disabled={!accepted}
        />
        <TouchableOpacity onPress={handleDeny} style={styles.denyButton}>
          <Text style={styles.denyButtonText}>Deny</Text>
        </TouchableOpacity>
      </View>

      {/* Acceptance checkbox */}
      <View style={styles.checkboxContainer}>
        <TouchableOpacity
          onPress={() => setAccepted(!accepted)}
          style={styles.checkbox}
        >
          {accepted && <Text style={styles.checkmark}>✓</Text>}
        </TouchableOpacity>
        <Text style={styles.checkboxLabel}>
          I accept the Terms and Conditions
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    padding: 24,
    justifyContent: "center",
  },
  backButton: {
    position: "absolute",
    top: 50,
    left: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.1)",
    justifyContent: "center",
    alignItems: "center",
  },
  backArrow: {
    fontSize: 24,
    color: "#2E7D32",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#2E7D32",
    textAlign: "center",
    marginBottom: 32,
  },
  termsContent: {
    flex: 1,
    marginBottom: 32,
  },
  termsText: {
    fontSize: 16,
    color: "#757575",
    lineHeight: 24,
  },
  buttonContainer: {
    width: "100%",
    marginBottom: 24,
  },
  denyButton: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 8,
    backgroundColor: "#E0E0E0",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  denyButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#757575",
  },
  checkboxContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#BDBDBD",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  checkmark: {
    fontSize: 16,
    color: "#4CAF50",
    fontWeight: "bold",
  },
  checkboxLabel: {
    fontSize: 14,
    color: "#757575",
  },
});
