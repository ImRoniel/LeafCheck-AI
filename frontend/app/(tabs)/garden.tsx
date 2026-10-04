import { CreatePlantForm } from "@/components/create-plant-form";
import { CollectionState, PlantList } from "@/components/plant-list";
import { Action, Notice, Screen, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useSpaces } from "@/context/spaces";
import { filterPlants } from "@/services/garden";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export default function Garden() {
  const data = useAppData();
  const { spaces, plantsBySpace, backgrounds } = useSpaces();
  const router = useRouter();
  const { view } = useLocalSearchParams<{ view?: string }>();
  const bySpace = view !== "all";
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const matches = filterPlants(data.plants, query);

  return (
    <Screen
      title="My Garden"
      refresh={() => void data.refresh()}
      loading={data.loading}
    >
      <View style={ui.row}>
        {(["space", "all"] as const).map((value) => {
          const selected = value === (bySpace ? "space" : "all");
          return (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => router.setParams({ view: value })}
              style={[
                ui.button,
                { flex: 1, backgroundColor: selected ? "#278448" : "#E1ECE1" },
              ]}
            >
              <Text style={[ui.buttonText, !selected && { color: "#193E27" }]}>
                {value === "space" ? "By Space" : "All Plants"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        accessibilityLabel="Search plants by name, species or location"
        style={ui.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Search name, species or location"
        autoCorrect={false}
        returnKeyType="search"
      />
      {!!query && <Action label="Clear search" onPress={() => setQuery("")} />}
      <Action label="My Spaces" onPress={() => router.push("/(tabs)/spaces")} />
      <CollectionState />
      {!data.guest && (
        <Action
          label="Scan Plant to Add"
          onPress={() => router.push("/(tabs)/scanner")}
        />
      )}
      {creating ? (
        <CreatePlantForm
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setCreated(true);
            setQuery("");
          }}
        />
      ) : (
        <Action
          label="Add plant manually"
          onPress={() => {
            setCreated(false);
            setCreating(true);
          }}
        />
      )}
      {created && <Notice>Plant added to your garden.</Notice>}
      {data.loaded && !!query.trim() && !matches.length && (
        <Notice>No matching plants. Try another name or species.</Notice>
      )}
      {bySpace ? (
        spaces.map((space) => {
          const plants = filterPlants(plantsBySpace[space] ?? [], query);
          if (query.trim() && !plants.length) return null;
          return (
            <View
              key={space}
              style={[ui.card, { backgroundColor: backgrounds[space] }]}
            >
              <Text accessibilityRole="header" style={ui.heading}>
                {space}
              </Text>
              <Text style={ui.text}>
                {plants.length} {plants.length === 1 ? "plant" : "plants"}
                {query.trim() ? " matching" : ""}
              </Text>
              <Action
                label={`Open ${space}`}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/space-detail",
                    params: { space },
                  })
                }
              />
              <PlantList plants={plants} />
              {!plants.length && (
                <Text style={ui.text}>
                  No plants here yet. Add a plant with this location.
                </Text>
              )}
            </View>
          );
        })
      ) : (
        <PlantList plants={matches} />
      )}
      {!data.guest && (
        <Action label="Archives" onPress={() => router.push("/archives")} />
      )}
    </Screen>
  );
}
