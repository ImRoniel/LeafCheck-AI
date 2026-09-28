import { CollectionState, PlantList } from "@/components/plant-list";
import { Action, Notice, Screen } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import { useSpaces } from "@/context/spaces";
import { useLocalSearchParams, useRouter } from "expo-router";

export default function SpaceDetail() {
  const { space } = useLocalSearchParams<{ space: string }>();
  const { spaces, plantsBySpace } = useSpaces();
  const data = useAppData();
  const local = useLocalState();
  const router = useRouter();
  const validSpace = typeof space === "string" && spaces.includes(space);
  const plants = validSpace ? (plantsBySpace[space] ?? []) : [];
  const canPair =
    validSpace &&
    (local.data.spaces.some((item) => item.name === space) ||
      (space !== "Unassigned" && data.loaded && !data.loading && !data.error));
  return (
    <Screen
      title={typeof space === "string" ? space : "Location"}
      back
      refresh={() => void data.refresh()}
      loading={data.loading}
    >
      <CollectionState />
      {canPair && (
        <Action
          label="Pair Sensor to this Space"
          onPress={() =>
            router.push({
              pathname: "/device-connection/scanner",
              params: { targetType: "space", targetId: space },
            })
          }
        />
      )}
      <PlantList plants={plants} />
      {data.loaded && !plants.length && (
        <Notice>No plants at this location.</Notice>
      )}
    </Screen>
  );
}
