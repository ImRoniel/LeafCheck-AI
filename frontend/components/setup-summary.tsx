import { useLocalState } from "@/context/local-state";
import { Text, View } from "react-native";
import { Action, Notice, ui } from "./screen";
import { useSetupAction } from "./setup-screen";

export function SetupSummary() {
  const local = useLocalState();
  const action = useSetupAction();
  if (local.data.onboarding.status === "pending") return null;
  const schedule = local.data.onboarding.plantId
    ? local.data.schedules[local.data.onboarding.plantId]
    : undefined;
  return (
    <View style={ui.card}>
      <Text style={ui.heading}>
        {schedule ? "Your saved care plan" : "Grow at your own pace"}
      </Text>
      {schedule ? (
        <Text style={ui.text}>
          Check watering every {schedule.wateringDays} days · {schedule.waterMl}{" "}
          ml planned · preferred time {schedule.reminderTime}. Check soil first.
          Automatic notifications are not enabled.
        </Text>
      ) : (
        <Text style={ui.text}>
          Setup is optional. Resume when you are ready to choose a space, plant,
          and care schedule.
        </Text>
      )}
      {action.error && <Notice>{action.error}</Notice>}
      <Action
        label={schedule ? "Review care schedule" : "Resume setup"}
        disabled={action.busy}
        onPress={() =>
          void action.run(() =>
            local.update((state) => ({
              ...state,
              onboarding: {
                ...state.onboarding,
                status: "pending",
                step: schedule ? "care" : state.onboarding.step,
              },
            })),
          )
        }
      />
    </View>
  );
}
