import { api } from "@/services/api";
import { selectPlantGuidance, telemetryGuidance } from "@/services/plant-guidance";
import { usePollingResource } from "@/services/use-polling-resource";
import type { Plant, TelemetryPayload } from "@/types";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { Action, Notice, ui } from "./screen";

export function PlantCareSummary({ plant, telemetry, telemetryError = false, linked }: {
  plant: Plant;
  telemetry: TelemetryPayload | null;
  telemetryError?: boolean;
  linked?: boolean;
}) {
  const router = useRouter();
  const resource = usePollingResource(`plant-guidance:${plant.id}`, async (signal) => {
    const [archives, tasks] = await Promise.all([
      api.fetchArchives({ signal, plantId: plant.id }),
      api.fetchTasks({ signal, plantId: plant.id }),
    ]);
    return selectPlantGuidance(plant.id, archives, tasks);
  }, { pollIntervalMs: 60_000 });
  const context = telemetryGuidance(telemetry?.timestamp, {
    failed: telemetryError,
    linked: linked ?? Boolean(plant.deviceId),
    simulated: linked === undefined && plant.simulated,
  });
  const latest = resource.data?.latest;
  const tasks = resource.data?.pending ?? [];
  return (
    <View style={ui.card}>
      <Text accessibilityRole="header" style={ui.heading}>Health and care</Text>
      <Notice>{context.message}</Notice>
      {resource.loading && !resource.data && <Text style={ui.text}>Loading saved diagnosis and care actions...</Text>}
      {resource.error && <>
        <Notice>Saved care guidance could not be refreshed. Previously loaded advice may be out of date.</Notice>
        <Action label="Retry care guidance" onPress={() => { void resource.refresh().catch(() => undefined); }} />
      </>}
      {latest ? <>
        <Text style={ui.heading}>Latest scan: {latest.healthStatus}</Text>
        <Text style={ui.text}>{new Date(latest.createdAt).toLocaleString()}</Text>
        <Text style={ui.text} numberOfLines={8}>{latest.rawAnalysisText || "No diagnostic text was saved."}</Text>
      </> : !resource.loading && !resource.error && <Text style={ui.text}>No saved diagnosis yet. Scan this plant to get care guidance.</Text>}
      {tasks.length > 0 && <Text accessibilityRole="header" style={ui.heading}>Saved care actions</Text>}
      {tasks.slice(0, 3).map((task) => <View key={task.id} style={{ gap: 4, marginTop: 12 }}>
        <Text style={ui.heading}>{task.title}</Text>
        <Text style={ui.text}>{task.description}</Text>
        <Text style={ui.text}>{task.urgency} · Due {new Date(task.dueDate).toLocaleString()}</Text>
      </View>)}
      {resource.data && tasks.length === 0 && <Text style={ui.text}>No pending saved care actions.</Text>}
      <Action label="View scan history" onPress={() => router.push("/archives")} />
      <Action label="View care tasks" onPress={() => router.push("/(tabs)/tasks")} />
    </View>
  );
}
