import { useAppData } from "@/context/app-data";
import type { Plant } from "@/types";
import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Action, Notice, ui } from "./screen";

export function EditPlantForm({
  plant,
  onSaved,
  onCancel,
}: {
  plant: Plant;
  onSaved: (plant: Plant) => void;
  onCancel: () => void;
}) {
  const { updatePlant } = useAppData();
  const [fields, setFields] = useState({
    name: plant.name,
    species: plant.species,
    location: plant.location ?? "",
    imageUrl: plant.imageUrl ?? "",
    minMoisture: String(plant.minMoisture ?? 30),
    maxMoisture: String(plant.maxMoisture ?? 80),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      if (!fields.minMoisture.trim() || !fields.maxMoisture.trim())
        throw new Error("Enter both moisture thresholds (0–100).");
      const updated = await updatePlant(plant.id, {
        ...fields,
        minMoisture: Number(fields.minMoisture),
        maxMoisture: Number(fields.maxMoisture),
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update plant.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <View style={ui.card}>
      <Text style={ui.heading}>Edit plant details</Text>
      {(
        [
          ["name", "Plant name"],
          ["species", "Species"],
          ["location", "Location"],
          ["imageUrl", "Image URL"],
          ["minMoisture", "Minimum moisture (%)"],
          ["maxMoisture", "Maximum moisture (%)"],
        ] as const
      ).map(([key, label]) => (
        <View key={key}>
          <Text style={ui.text}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            style={ui.input}
            value={fields[key]}
            editable={!saving}
            keyboardType={key.endsWith("Moisture") ? "decimal-pad" : "default"}
            autoCapitalize={key === "imageUrl" ? "none" : "sentences"}
            onChangeText={(value) =>
              setFields((current) => ({ ...current, [key]: value }))
            }
          />
        </View>
      ))}
      {error && <Notice>{error}</Notice>}
      <Action
        label={saving ? "Saving plant..." : "Save changes"}
        disabled={saving}
        onPress={() => void save()}
      />
      <Action label="Cancel editing" disabled={saving} onPress={onCancel} />
    </View>
  );
}
