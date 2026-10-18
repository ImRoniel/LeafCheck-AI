import { Action, Notice, ui } from "@/components/screen";
import { SetupScreen, useSetupAction } from "@/components/setup-screen";
import { useLocalState } from "@/context/local-state";
import { Text, View } from "react-native";

export default function SensorChoice() {
  const local = useLocalState();
  const action = useSetupAction();
  return (
    <SetupScreen
      title="Do you have a LeafCheck sensor?"
      subtitle="You're welcome here without one. Sensors are optional, never a requirement to start caring for your plants."
      progress="Your care mode"
      back="plant"
      {...action}
    >
      <View style={ui.card}>
        <Text style={ui.heading}>No sensor? Start in Manual Mode</Text>
        <Text style={ui.text}>
          Save a care schedule and organize your plants by space. Signed-in
          users can scan leaves with the AI camera without hardware.
        </Text>
        <Text style={ui.note}>
          Your care schedule is saved on this device. You can track completed
          care in Care Tasks. Automatic notifications are not enabled.
        </Text>
      </View>
      <View style={ui.card}>
        <Text style={ui.heading}>Sensors can add live observations</Text>
        <Text style={ui.text}>
          Compatible, already-linked hardware can report soil moisture,
          temperature, humidity, and light. After signing in, use Pair a Sensor
          on your plant profile or Pair a new sensor in Settings to connect your device.
        </Text>
      </View>
      <Action
        label={action.busy ? "Saving…" : "Start Free in Manual Mode"}
        disabled={action.busy}
        onPress={() =>
          void action.run(() =>
            local.update((state) => ({
              ...state,
              onboarding: { ...state.onboarding, mode: "manual", step: "care" },
            })),
          )
        }
      />
      <Notice>
        No purchase is needed. This choice does not disconnect sensors already
        associated with your plants.
      </Notice>
    </SetupScreen>
  );
}
