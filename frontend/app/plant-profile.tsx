import { DeletePlantAction } from "@/components/delete-plant-action";
import { EditPlantForm } from "@/components/edit-plant-form";
import { PlantTelemetry } from "@/components/plant-telemetry";
import { PlantCareSummary } from "@/components/plant-care-summary";
import { Action, Notice, Screen, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { fetchPlantTelemetry } from "@/services/api";
import { useAuth } from "@/context/auth";
import type { PlantTelemetry as SensorState } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Text, View } from "react-native";

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
  const [editing, setEditing] = useState(false);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    setSensor(null);
    setEditing(false);
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
  const retrySensor = () => setAttempt((value) => value + 1);
  const pairSensor = () => router.push({ pathname: "/device-connection/scanner", params: { targetType: "plant", targetId: typeof id === "string" ? id : "" } });
  return (
    <Screen
      title={plant?.name ?? "Plant profile"}
      back
      refresh={retrySensor}
      loading={loading || collectionLoading}
    >
      {(!validRoute || (auth.status === "authenticated" && !validId)) && <Notice>Missing or invalid plant ID</Notice>}
      {!loaded && !collectionError && <Notice>Loading plant collection...</Notice>}
      {collectionError && <><Notice>{collectionError}</Notice><Action label="Retry plant collection" onPress={() => { void refresh(); }} /></>}
      {validRoute && loaded && !collectionLoading && !collectionError && !plant && <Notice>Plant not found in your collection.</Notice>}
      {plant && plant.id === id && (
        <>
          <View style={[ui.card, { alignItems: "center" }]}>
            {plant.imageUrl ? (
              <Image
                source={{ uri: plant.imageUrl }}
                style={{ width: "100%", height: 230, borderRadius: 20 }}
              />
            ) : (
              <Ionicons name="leaf-outline" size={120} color="#278448" />
            )}
            <Text style={ui.heading}>{plant.species}</Text>
            <Text style={ui.text}>
              {plant.location || "Unassigned"} · {plant.healthStatus}
            </Text>
            <Text style={ui.text}>
              Last scanned:{" "}
              {plant.lastScannedAt
                ? new Date(plant.lastScannedAt).toLocaleString()
                : "Not recorded"}
            </Text>
          </View>
          {editing ? (
            <EditPlantForm
              key={`edit:${plant.id}`}
              plant={plant}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
              }}
            />
          ) : (
            <Action
              label="Edit plant details"
              onPress={() => setEditing(true)}
            />
          )}
          <Text style={ui.text}>
            Moisture thresholds: {plant.minMoisture ?? 30}% –{" "}
            {plant.maxMoisture ?? 80}%
          </Text>
          <Action
            label="Scan this plant"
            onPress={() =>
              router.push({
                pathname: "/(tabs)/scanner",
                params: { plantId: plant.id },
              })
            }
          />
          {auth.status === "authenticated" ? <PlantTelemetry key={`telemetry:${plant.id}`} plant={plant} payload={payload} loading={loading} error={error} onRefresh={retrySensor} onPair={pairSensor} /> : <><PlantCareSummary key={plant.id} plant={plant} telemetry={null} linked={false} /><Notice>Sign in to connect a sensor.</Notice></>}
          {!editing && (
            <DeletePlantAction key={`delete:${plant.id}`} id={plant.id} name={plant.name} />
          )}
        </>
      )}
    </Screen>
  );
}
