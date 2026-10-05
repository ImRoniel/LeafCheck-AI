import {
  DeviceConnectionScreen,
  deviceStyles as s,
} from "@/components/device-connection-screen";
import { Action, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import type { DeviceConnectionRouteParams } from "@/types/device-connection";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text } from "react-native";

export default function DeviceConnectionSuccess() {
  const { confirmedPairing } = useAppData();
  const router = useRouter();
  const { deviceId } = useLocalSearchParams<DeviceConnectionRouteParams>();
  const connection = confirmedPairing;
  if (!connection || deviceId !== connection.device.id) return <Redirect href="/device-connection/scanner" />;
  return (
    <DeviceConnectionScreen title="Device setup complete" step={4} description="Your sensor pairing is confirmed.">
      <ScrollView contentContainerStyle={s.center}>
        <Ionicons
          name="checkmark-circle"
          size={100}
          color="#278448"
          accessible={false}
        />
        <Text accessibilityRole="header" style={ui.heading}>
          Sensor paired successfully
        </Text>
        <Text style={s.text}>
          {connection.device.name} is paired with Plant: {connection.plant.name}.
        </Text>
        {connection.refreshWarning && <Text accessibilityRole="alert" style={s.status}>{connection.refreshWarning}</Text>}
        <Action label="View paired plant" onPress={() => router.replace({ pathname: "/plant-profile", params: { id: connection.plant.id } })} />
        <Action
          label="+ Add Sensor"
          onPress={() => router.replace("/device-connection/scanner")}
        />
        <Action
          label="Return to Dashboard"
          onPress={() => router.dismissTo("/(tabs)")}
        />
      </ScrollView>
    </DeviceConnectionScreen>
  );
}
