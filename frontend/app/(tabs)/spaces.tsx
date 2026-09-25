import { CreatePlantForm } from "@/components/create-plant-form";
import { CollectionState } from "@/components/plant-list";
import { Action, Notice, Screen, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useSpaces } from "@/context/spaces";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text } from "react-native";

export default function Spaces() {
  const { spaces, plantsBySpace, backgrounds } = useSpaces();
  const data = useAppData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  return (
    <Screen
      title={"MY\nSPACES"}
      refresh={() => void data.refresh()}
      loading={data.loading}
    >
      <Notice>
        Plants are grouped by location. Add a location when creating a plant, or
        find it under Unassigned.
      </Notice>
      <CollectionState />
      {!data.guest && (
        <>
          <Action
            label="📷 Scan Plant to Add"
            onPress={() => router.push("/(tabs)/camera")}
          />
          {creating ? (
            <CreatePlantForm
              onClose={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                setCreated(true);
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
        </>
      )}
      {created && (
        <Notice>Plant created. Open its space below to view it.</Notice>
      )}
      {spaces.map((space) => (
        <Pressable
          accessibilityRole="button"
          key={space}
          style={[
            ui.card,
            { backgroundColor: backgrounds[space], minHeight: 150 },
          ]}
          onPress={() =>
            router.push({ pathname: "/(tabs)/space-detail", params: { space } })
          }
        >
          <Ionicons name="leaf-outline" size={42} color="#278448" />
          <Text style={ui.heading}>{space}</Text>
          <Text style={ui.text}>{plantsBySpace[space].length} plants</Text>
        </Pressable>
      ))}
      {!data.guest && (
        <Action label="Archives" onPress={() => router.push("/archives")} />
      )}
    </Screen>
  );
}
