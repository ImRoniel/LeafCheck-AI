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
            Guest plants and care preferences stay on this device. Sign in for a
            separate cloud collection, telemetry, and AI scans.
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
        <>
          <Notice>
            Your collection is empty. Scan a plant with your camera to identify
            its species and create it automatically.
          </Notice>
          <Action
            label="Scan Plant to Add"
            onPress={() => router.push("/(tabs)/scanner")}
          />
        </>
      )}
    </>
  );
}
export function PlantList({ plants }: { plants: Plant[] }) {
  const router = useRouter();
  const { guest } = useAppData();
  return (
    <>
      {plants.map((plant) => (
        <Pressable
          key={plant.id}
          accessibilityRole={guest ? "text" : "button"}
          accessibilityLabel={
            guest
              ? `${plant.name}, ${plant.species}, local guest plant`
              : `View ${plant.name}`
          }
          disabled={guest}
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
            <Text style={ui.text}>{plant.location || "Unassigned"}</Text>
            <Text
              style={{
                alignSelf: "flex-start",
                borderRadius: 12,
                paddingHorizontal: 10,
                paddingVertical: 4,
                fontWeight: "700",
                color: "#193E27",
                backgroundColor: {
                  healthy: "#DDF4E3",
                  warning: "#FFF0C2",
                  critical: "#FFDCDC",
                  unknown: "#E8ECE9",
                }[plant.healthStatus],
              }}
            >
              {
                {
                  healthy: "Healthy",
                  warning: "Warning",
                  critical: "Critical",
                  unknown: "Unknown",
                }[plant.healthStatus]
              }
            </Text>
          </View>
        </Pressable>
      ))}
    </>
  );
}
