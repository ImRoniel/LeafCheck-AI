import { DeletePlantAction } from "@/components/delete-plant-action";
import { EditPlantForm } from "@/components/edit-plant-form";
import { PlantTelemetry } from "@/components/plant-telemetry";
import { Action, Notice, Screen, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { fetchPlant, seedTelemetry } from "@/services/api";
import type { Plant } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Text, View } from "react-native";

export default function PlantProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { devices, refresh } = useAppData();
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [telemetryVersion, setTelemetryVersion] = useState(0);
  const [plant, setPlant] = useState<Plant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  useFocusEffect(
    useCallback(() => {
      void attempt;
      const controller = new AbortController();
      setPlant(null);
      setEditing(false);
      setLoading(true);
      setError(null);
      if (!id) {
        setError("Missing plant ID");
        setLoading(false);
        return;
      }
      fetchPlant(id, { signal: controller.signal })
        .then((p) => {
          if (!controller.signal.aborted) setPlant(p);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      return () => controller.abort();
    }, [id, attempt]),
  );
  return (
    <Screen
      title={plant?.name ?? "Plant profile"}
      back
      refresh={() => setAttempt((n) => n + 1)}
      loading={loading}
    >
      {error && (
        <>
          <Notice>{error}</Notice>
          <Action
            label="Retry plant"
            onPress={() => setAttempt((n) => n + 1)}
          />
        </>
      )}
      {loading && <Notice>Loading plant...</Notice>}
      {plant && (
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
              key={plant.id}
              plant={plant}
              onCancel={() => setEditing(false)}
              onSaved={(updated) => {
                setPlant(updated);
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
                pathname: "/(tabs)/camera",
                params: { plantId: plant.id },
              })
            }
          />
          <Action
            label="Local device mapping"
            onPress={() =>
              router.push({
                pathname: "/settings",
                params: { plantId: plant.id },
              })
            }
          />
          {(!plant.deviceId || plant.simulated) && (
            <Action
              label={
                seeding
                  ? "Generating demo readings..."
                  : "Generate Demo Readings"
              }
              disabled={seeding}
              onPress={async () => {
                setSeeding(true);
                setSeedError(null);
                try {
                  const updated = await seedTelemetry(plant.id);
                  setPlant(updated);
                  setTelemetryVersion((version) => version + 1);
                  await refresh();
                } catch (e) {
                  setSeedError(
                    e instanceof Error
                      ? e.message
                      : "Unable to generate readings.",
                  );
                } finally {
                  setSeeding(false);
                }
              }}
            />
          )}
          {seedError && <Notice>{seedError}</Notice>}
          {plant.simulated && (
            <Notice>Simulated sensor data — no hardware connected</Notice>
          )}
          {plant.deviceId || devices[plant.id] ? (
            <PlantTelemetry
              key={`${plant.deviceId || devices[plant.id]}:${telemetryVersion}`}
              deviceId={plant.deviceId || devices[plant.id]}
              linked={!!plant.deviceId}
            />
          ) : (
            <Notice>
              No local device mapping. Image-only scanning remains available.
            </Notice>
          )}
          {!editing && (
            <DeletePlantAction key={plant.id} id={plant.id} name={plant.name} />
          )}
        </>
      )}
    </Screen>
  );
}
