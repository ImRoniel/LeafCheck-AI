import {
  DeviceConnectionScreen,
  deviceStyles as s,
} from "@/components/device-connection-screen";
import { Action, ui } from "@/components/screen";
import { mockHardwareNodes } from "@/services/device-connection";
import { useRouter } from "expo-router";
import { FlatList, Pressable, Text } from "react-native";

export default function DeviceSelection() {
  const router = useRouter();
  return (
    <DeviceConnectionScreen title="Choose a device" step={2}>
      <FlatList
        data={mockHardwareNodes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <Text style={s.text}>
            Demo devices found. Select a node to assign it to your garden.
          </Text>
        }
        ListEmptyComponent={
          <Text style={s.status}>
            No demo devices found. Scan again to retry.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Select ${item.name}, mock device`}
            style={s.node}
            onPress={() =>
              router.navigate({
                pathname: "/device-connection/assignment",
                params: { deviceId: item.id },
              })
            }
          >
            <Text style={ui.heading}>{item.name}</Text>
            <Text style={s.text}>{item.detail}</Text>
            <Text style={s.text}>Mock device · {item.id}</Text>
          </Pressable>
        )}
        ListFooterComponent={
          <Action
            label="Scan again"
            onPress={() => router.replace("/device-connection/scanner")}
          />
        }
      />
    </DeviceConnectionScreen>
  );
}
