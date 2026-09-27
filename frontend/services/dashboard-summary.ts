import type { Plant } from "@/types/plant";

type DashboardCollection = {
  plants: readonly Plant[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  guest: boolean;
};

export function getDashboardCollectionStatus(
  data: Pick<DashboardCollection, "loaded" | "loading" | "error">,
) {
  if (data.loading) {
    return {
      message: data.loaded
        ? "Updating Plant Overview…"
        : "Loading Plant Overview…",
      canRetry: false,
    };
  }
  if (data.error) {
    return {
      message: data.loaded
        ? "Plant Overview could not be refreshed. Showing the last loaded collection."
        : "Plant Overview could not be loaded. Please try again.",
      canRetry: true,
    };
  }
  return data.loaded
    ? null
    : { message: "Loading Plant Overview…", canRetry: false };
}

export function getDashboardAlert(data: DashboardCollection) {
  if (data.guest) {
    return "Sensors are optional. Guest mode supports local plants and care preferences. Sign in for AI camera scans and telemetry. Connect Device previews a mock setup only; physical pairing is not available.";
  }
  // A failed/refreshing collection cannot establish whether a sensor is linked.
  if (!data.loaded || data.loading || data.error) return null;
  const hasDemo = data.plants.some((plant) => plant.simulated);
  const hasLinked = data.plants.some(
    (plant) => !plant.simulated && Boolean(plant.deviceId?.trim()),
  );
  if (hasDemo || hasLinked) {
    return [
      hasDemo
        ? "Demo plants use simulated telemetry, not live sensor readings."
        : "",
      hasLinked
        ? "Sensor links are saved for this collection; a link does not confirm live readings. Open a plant to check sample times and telemetry status."
        : "No physical sensor links are recorded for this collection.",
      "AI camera scans and manual care work without hardware. Connect Device previews a mock setup only; physical pairing is not available.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "No sensor links are recorded for this collection. Local device mappings do not verify a physical connection. Continue using AI camera scans and manual care without hardware. Connect Device previews a mock setup only; physical pairing is not available.";
}
