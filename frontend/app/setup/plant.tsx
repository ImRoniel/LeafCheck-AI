import { Action, Notice, ui } from "@/components/screen";
import {
  SetupChoice,
  SetupField,
  SetupScreen,
  useSetupAction,
} from "@/components/setup-screen";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import type { Plant } from "@/types/plant";
import { useRef, useState } from "react";
import { Text } from "react-native";

const speciesOptions = [
  { species: "Monstera deliciosa", common: "Swiss cheese plant" },
  { species: "Dracaena trifasciata", common: "Snake plant" },
  { species: "Epipremnum aureum", common: "Golden pothos" },
] as const;

export default function PlantSetup() {
  const local = useLocalState();
  const data = useAppData();
  const [query, setQuery] = useState("");
  const [species, setSpecies] = useState("");
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    local.data.onboarding.plantId,
  );
  const created = useRef<Plant | null>(null);
  const [hasCreated, setHasCreated] = useState(false);
  const action = useSetupAction();
  const space = local.data.spaces.find(
    (s) => s.id === local.data.onboarding.spaceId,
  );
  const candidates = speciesOptions.filter((p) =>
    `${p.species} ${p.common}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  const selectPlant = async (plant: Plant) => {
    await local.update((state) => ({
      ...state,
      onboarding: {
        ...state.onboarding,
        plantId: plant.id,
        step: "sensor-choice",
      },
    }));
  };
  const save = () =>
    action.run(async () => {
      if (selectedId) {
        const selected = data.plants.find((p) => p.id === selectedId);
        if (!selected)
          throw new Error(
            "That plant is no longer available. Select another plant or create one.",
          );
        await selectPlant(selected);
        return;
      }
      if (!name.trim() || !species.trim())
        throw new Error("Enter a plant name and species.");
      // Keep a successful API result when a later local write fails, so Retry does not POST twice.
      const plant =
        created.current ??
        (await data.createPlant({
          name: name.trim(),
          species: species.trim(),
          location: space?.name,
        }));
      created.current = plant;
      setHasCreated(true);
      await selectPlant(plant);
    });
  return (
    <SetupScreen
      title="What plant did you get?"
      subtitle={`Choose a familiar species or enter your own.${space ? ` New plants will join ${space.name}.` : ""}`}
      progress="Setup 3 of 3"
      back="space"
      {...action}
    >
      {data.error && (
        <>
          <Notice>{data.error}</Notice>
          <Action
            label="Retry collection"
            onPress={() => void data.refresh()}
          />
        </>
      )}
      {data.loading && <Notice>Loading your existing plants…</Notice>}
      {data.plants.length > 0 && (
        <>
          <Text style={ui.heading}>Use an existing plant</Text>
          {data.plants.map((plant) => (
            <SetupChoice
              key={plant.id}
              title={plant.name}
              description={`${plant.species} · ${plant.location || "Unassigned"}`}
              selected={selectedId === plant.id}
              onPress={() => setSelectedId(plant.id)}
            />
          ))}
          <Action
            label="Add a different plant"
            onPress={() => {
              setSelectedId(null);
              created.current = null;
              setHasCreated(false);
            }}
          />
        </>
      )}
      {!selectedId && (
        <>
          <SetupField
            label="Search starter species"
            value={query}
            onChangeText={setQuery}
            placeholder="Try monstera"
          />
          {candidates.map((plant) => (
            <SetupChoice
              key={plant.species}
              title={plant.species}
              description={plant.common}
              selected={species === plant.species}
              onPress={() => {
                setSpecies(plant.species);
                setName(plant.common);
              }}
            />
          ))}
          {!candidates.length && (
            <Notice>
              No starter match. Enter the species below, or use “Unidentified
              houseplant” and scan after setup.
            </Notice>
          )}
          <SetupField
            label="Species"
            value={species}
            onChangeText={setSpecies}
            maxLength={200}
            placeholder="Species or Unidentified houseplant"
          />
          <SetupField
            label="Plant name"
            value={name}
            onChangeText={setName}
            maxLength={100}
            placeholder="My Monstera"
          />
        </>
      )}
      <Notice>
        The starter list is local, not a live catalog. Difficulty and pet-safety
        ratings are not inferred. Cloud identification is available from Camera
        after an authenticated plant is saved.
      </Notice>
      {hasCreated && (
        <Notice>
          Your plant was created. Continue will retry saving setup progress
          without creating another plant.
        </Notice>
      )}
      <Action
        label={
          action.busy
            ? "Saving…"
            : selectedId
              ? "Continue with this plant"
              : "This is my plant"
        }
        disabled={
          action.busy ||
          !data.loaded ||
          (!selectedId && (!name.trim() || !species.trim()))
        }
        onPress={() => void save()}
      />
      <Notice>
        If a network error makes creation uncertain, refresh the collection and
        select the saved plant before trying again.
      </Notice>
    </SetupScreen>
  );
}
