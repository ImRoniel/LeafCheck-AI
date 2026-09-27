import {
  DeviceConnectionScreen,
  deviceStyles as s,
} from "@/components/device-connection-screen";
import { Action, ui } from "@/components/screen";
import { useLocalState } from "@/context/local-state";
import { findMockDevice } from "@/services/device-connection";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { ScrollView, Text } from "react-native";

export default function DeviceConnectionSuccess() {
  const { data } = useLocalState();
  const router = useRouter();
  const connection = data.mockDeviceConnection;
  if (!connection) return <Redirect href="/device-connection/scanner" />;
  return (
    <DeviceConnectionScreen title="Device setup complete" step={4}>
      <ScrollView contentContainerStyle={s.center}>
        <Ionicons
          name="checkmark-circle"
          size={100}
          color="#278448"
          accessible={false}
        />
        <Text accessibilityRole="header" style={ui.heading}>
          Mock connection successful
        </Text>
        <Text style={s.text}>
          {findMockDevice(connection.deviceId)?.name} is assigned to{" "}
          {connection.target.kind === "space" ? "Space" : "Plant"}:{" "}
          {connection.target.name}.
        </Text>
        <Text style={s.status}>
          Your dashboard now shows Mode: Auto (With IoT). This is a mock setup,
          not live monitoring or automatic watering. Existing telemetry and
          manual care are unchanged.
        </Text>
        <Action
          label="Return to Dashboard"
          onPress={() => router.dismissTo("/(tabs)")}
        />
      </ScrollView>
    </DeviceConnectionScreen>
  );
}
