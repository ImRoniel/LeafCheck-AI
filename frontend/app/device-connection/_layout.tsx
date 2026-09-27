import { Stack } from "expo-router";

export default function DeviceConnectionStack() {
  return (
    <Stack
      initialRouteName="scanner"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#F8FBF7" },
      }}
    >
      <Stack.Screen name="scanner" />
      <Stack.Screen name="selection" />
      <Stack.Screen name="assignment" />
      <Stack.Screen name="success" />
    </Stack>
  );
}
