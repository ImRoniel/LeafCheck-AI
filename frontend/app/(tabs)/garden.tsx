import { Redirect } from "expo-router";

/** Keep saved Garden links working through the canonical My Spaces route. */
export default function GardenRedirect() {
  return <Redirect href="/(tabs)/spaces" />;
}
