import { useAppData } from "@/context/app-data";
import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Action, Notice, ui } from "./screen";

export function CreatePlantForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { createPlant } = useAppData();
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [location, setLocation] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const submit = async () => {
    if (pending.current) return;
    if (!name.trim() || !species.trim()) {
      setError("Enter a plant name and species.");
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await createPlant({ name, species, location, imageUrl });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create plant.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <View style={ui.card}>
      <Text accessibilityRole="header" style={ui.heading}>
        Create plant
      </Text>
      <Text style={ui.text}>
        Name and species are required. A location groups your plant into a
        space.
      </Text>
      <Text style={ui.text}>Plant name *</Text>
      <TextInput
        accessibilityLabel="Plant name, required"
        style={ui.input}
        value={name}
        onChangeText={setName}
        maxLength={100}
        editable={!saving}
        placeholder="e.g. Kitchen basil"
      />
      <Text style={ui.text}>Species *</Text>
      <TextInput
        accessibilityLabel="Species, required"
        style={ui.input}
        value={species}
        onChangeText={setSpecies}
        maxLength={200}
        editable={!saving}
        placeholder="e.g. Basil"
      />
      <Text style={ui.text}>Location (optional)</Text>
      <TextInput
        accessibilityLabel="Location, optional"
        style={ui.input}
        value={location}
        onChangeText={setLocation}
        maxLength={100}
        editable={!saving}
        placeholder="e.g. Kitchen"
      />
      <Text style={ui.text}>Image URL (optional)</Text>
      <TextInput
        accessibilityLabel="Image URL, optional"
        style={ui.input}
        value={imageUrl}
        onChangeText={setImageUrl}
        maxLength={2048}
        editable={!saving}
        placeholder="https://example.com/plant.jpg"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {error && <Notice>{error}</Notice>}
      <Action
        label={saving ? "Creating plant..." : "Save plant"}
        disabled={saving}
        onPress={() => void submit()}
      />
      <Action label="Cancel" disabled={saving} onPress={onClose} />
    </View>
  );
}
