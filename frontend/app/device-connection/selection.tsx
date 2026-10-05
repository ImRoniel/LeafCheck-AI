import type { DeviceConnectionRouteParams } from "@/types/device-connection";
import { Redirect, useLocalSearchParams } from "expo-router";

/** Legacy discovery links must enter the authenticated physical claim flow. */
export default function DeviceSelection() {
  const { targetType, targetId } = useLocalSearchParams<DeviceConnectionRouteParams>();
  return <Redirect href={{ pathname: "/device-connection/scanner", params: { targetType, targetId } }} />;
}
