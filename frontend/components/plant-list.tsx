import { useAppData } from "@/context/app-data";
import type { Plant } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { Action, Notice, ui } from "./screen";
export function CollectionState() {
  const data = useAppData();
  const router = useRouter();
  return (
    <>
      {data.guest && (
        <>
          <Notice>
            Guest mode is local only. Sign in to view your plants, telemetry, or
            submit cloud scans.
          </Notice>
          <Action label="Sign in" onPress={() => router.push("/login")} />
        </>
      )}
      {data.loading && <Notice>Loading plants…</Notice>}
      {data.error && (
        <>
          <Notice>
            {data.error}
            {data.loaded ? " Showing the last loaded collection." : ""}
          </Notice>
          <Action
            label="Retry loading plants"
            onPress={() => void data.refresh()}
          />
        </>
      )}
      {data.loaded && !data.loading && !data.plants.length && (
        <Notice>
          Your collection is empty. Create your first plant from My Spaces.
        </Notice>
      )}
    </>
  );
}
export function PlantList({ plants }: { plants: Plant[] }) {
  const router = useRouter();
  return (
    <>
      {plants.map((plant) => (
        <Pressable
          key={plant.id}
          accessibilityRole="button"
          accessibilityLabel={`View ${plant.name}`}
          style={[ui.card, { flexDirection: "row", alignItems: "center" }]}
          onPress={() =>
            router.push({
              pathname: "/plant-profile",
              params: { id: plant.id },
            })
          }
        >
          {plant.imageUrl ? (
            <Image
              source={{ uri: plant.imageUrl }}
              style={{ width: 76, height: 90, borderRadius: 15 }}
            />
          ) : (
            <Ionicons name="leaf-outline" size={64} color="#278448" />
          )}
          <View style={{ flex: 1 }}>
            <Text style={ui.heading}>{plant.name}</Text>
            <Text style={ui.text}>{plant.species}</Text>
            <Text style={ui.text}>
              {plant.location || "Unassigned"} · {plant.healthStatus}
            </Text>
          </View>
        </Pressable>
      ))}
    </>
  );
}
