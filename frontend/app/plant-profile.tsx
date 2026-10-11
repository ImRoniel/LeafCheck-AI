import { DeletePlantAction } from "@/components/delete-plant-action";
import { EditPlantForm } from "@/components/edit-plant-form";
import { PlantTelemetry } from "@/components/plant-telemetry";
import { PlantProfileHeader } from "@/components/PlantProfileHeader";
import { PlantDiagnosisCard } from "@/components/PlantDiagnosisCard";
import { PlantCareTasksCard } from "@/components/PlantCareTasksCard";
import { usePlantProfileGuidance } from "@/hooks/use-plant-profile-guidance";
import { Action, Notice, Screen } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { fetchPlantTelemetry } from "@/services/api";
import { useAuth } from "@/context/auth";
import type { PlantTelemetry as SensorState } from "@/types";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";

export default function PlantProfile() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const { plants, loaded, loading: collectionLoading, error: collectionError, refresh } = useAppData();
  const auth = useAuth();
  const validId = typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const validRoute = typeof id === "string" && id.trim().length > 0;
  const plant = plants.find((item) => item.id === id);
  const [sensor, setSensor] = useState<{ id: string; generation: number; payload: SensorState } | null>(null);
  const [failure, setFailure] = useState<{ id: string; generation: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const guidance = usePlantProfileGuidance(typeof id === "string" ? id : "", validId && Boolean(plant) && auth.status === "authenticated");
  const [editing, setEditing] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    setEditing(null);
    setDeleting(null);
    setFailure(null);
    setLoading(false);
    if (!validId || typeof id !== "string" || auth.status !== "authenticated") return () => controller.abort();
    setLoading(true);
    Promise.resolve().then(() => fetchPlantTelemetry(id, { signal: controller.signal }))
      .then((payload) => {
        if (!controller.signal.aborted) setSensor({ id, generation: auth.generation, payload });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFailure({ id, generation: auth.generation, message: cause instanceof Error ? cause.message : "Unable to load sensor readings." });
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, auth.generation, auth.status, attempt]));
  const payload = sensor !== null && sensor.id === id && sensor.generation === auth.generation ? sensor.payload : null;
  const error = failure !== null && failure.id === id && failure.generation === auth.generation ? failure.message : null;
  const retrySensor = () => setAttempt(value => value + 1);
  const pairSensor = () => router.push({ pathname: "/device-connection/scanner", params: { targetType: "plant", targetId: typeof id === "string" ? id : "" } });
  const retryGuidance = () => { void guidance.refresh().catch(() => undefined); };
  return (
    <Screen refresh={() => { retrySensor(); retryGuidance(); }} loading={loading || collectionLoading}>
      {(!validRoute || (auth.status === "authenticated" && !validId)) && <Notice>Missing or invalid plant ID</Notice>}
      {!loaded && !collectionError && <Notice>Loading plant collection...</Notice>}
      {collectionError && <><Notice>{collectionError}</Notice><Action label="Retry plant collection" variant="secondary" onPress={() => { void refresh(); }} /></>}
      {validRoute && loaded && !collectionLoading && !collectionError && !plant && <Notice>Plant not found in your collection.</Notice>}
      {plant && plant.id === id && <>
        <PlantProfileHeader key={`header:${plant.id}`} plant={plant}
          onBack={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/spaces")}
          onEdit={() => { setDeleting(null); setEditing(plant.id); }}
          onDelete={() => { setEditing(null); setDeleting(plant.id); }} />
        {editing === plant.id && <EditPlantForm key={`edit:${plant.id}`} plant={plant} onCancel={() => setEditing(null)} onSaved={() => setEditing(null)} />}
        {deleting === plant.id && <DeletePlantAction key={`delete:${plant.id}`} id={plant.id} name={plant.name} initiallyConfirming onCancel={() => setDeleting(null)} />}
        <PlantTelemetry key={`telemetry:${plant.id}`} plant={plant} payload={payload} loading={loading} error={error} onRefresh={retrySensor} onPair={pairSensor} authenticated={auth.status === "authenticated"} />
        <PlantDiagnosisCard key={`diagnosis:${plant.id}`} latest={guidance.data?.latest ?? null} loading={guidance.loading} error={Boolean(guidance.error)} onRetry={retryGuidance}
          onScan={() => router.push({ pathname: "/(tabs)/scanner", params: { plantId: plant.id } })}
          onHistory={() => router.push("/archives")} />
        <PlantCareTasksCard key={`tasks:${plant.id}`} tasks={guidance.data?.pending ?? []} loading={guidance.loading} error={Boolean(guidance.error)} onViewAll={() => router.push("/(tabs)/tasks")} />
      </>}
    </Screen>
  );
}
