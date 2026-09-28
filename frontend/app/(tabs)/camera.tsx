import { Redirect, useLocalSearchParams } from "expo-router";

export default function LegacyCamera() {
  const { plantId, deviceId } = useLocalSearchParams<{
    plantId?: string;
    deviceId?: string;
  }>();
  return (
    <Redirect
      href={{ pathname: "/(tabs)/scanner", params: { plantId, deviceId } }}
    />
  );
}
