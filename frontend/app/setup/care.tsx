import { Action, Notice, ui } from "@/components/screen";
import {
    SetupField,
    SetupScreen,
    useSetupAction,
} from "@/components/setup-screen";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import {
    scheduleInputError,
    suggestedCareSchedule,
} from "@/services/care-schedule";
import type { CareSchedule } from "@/types/local-state";
import { useState } from "react";
import { Text } from "react-native";

function CareForm({
  initial,
  plantName,
}: {
  initial: CareSchedule;
  plantName: string;
}) {
  const local = useLocalState();
  const action = useSetupAction();
  const [watering, setWatering] = useState(String(initial.wateringDays));
  const [amount, setAmount] = useState(String(initial.waterMl));
  const [fertilizing, setFertilizing] = useState(
    String(initial.fertilizingDays),
  );
  const [fertilizer, setFertilizer] = useState(initial.fertilizer);
  const [rotation, setRotation] = useState(String(initial.rotationDays));
  const [time, setTime] = useState(initial.reminderTime);
  const save = () =>
    action.run(async () => {
      const schedule: CareSchedule = {
        plantId: initial.plantId,
        wateringDays: Number(watering),
        waterMl: Number(amount),
        fertilizingDays: Number(fertilizing),
        fertilizer: fertilizer.trim(),
        rotationDays: Number(rotation),
        reminderTime: time.trim(),
        updatedAt: new Date().toISOString(),
      };
      const error = scheduleInputError(schedule);
      if (error) throw new Error(error);
      await local.update((state) => ({
        ...state,
        schedules: { ...state.schedules, [schedule.plantId]: schedule },
        onboarding: { ...state.onboarding, status: "completed" },
      }));
    });
  return (
    <SetupScreen
      title={`${plantName} — Care schedule`}
      subtitle="An editable starting point based on plant group and your room-light preference, not live measurements."
      progress="Ready to grow"
      back="sensor-choice"
      {...action}
    >
      <Notice>
        {local.data.experience === "experienced"
          ? "Adjust intervals to your potting mix, season, and observations."
          : "Check the soil before watering. A reminder is a cue to check, not an instruction to water damp soil."}{" "}
        Amount depends on pot size and drainage; 350 ml is only an example.
        Fertilize only when appropriate and follow the product label.
      </Notice>
      <Text style={ui.heading}>Watering check</Text>
      <SetupField
        label="Check every (days)"
        keyboardType="number-pad"
        value={watering}
        onChangeText={setWatering}
        maxLength={3}
      />
      <SetupField
        label="Planned water amount (ml)"
        keyboardType="number-pad"
        value={amount}
        onChangeText={setAmount}
        maxLength={5}
      />
      <Text style={ui.heading}>Fertilizing</Text>
      <SetupField
        label="Review fertilizing every (days)"
        keyboardType="number-pad"
        value={fertilizing}
        onChangeText={setFertilizing}
        maxLength={3}
      />
      <SetupField
        label="Fertilizer type / instructions"
        value={fertilizer}
        onChangeText={setFertilizer}
        maxLength={100}
      />
      <Text style={ui.heading}>Rotation</Text>
      <SetupField
        label="Turn 90° every (days)"
        keyboardType="number-pad"
        value={rotation}
        onChangeText={setRotation}
        maxLength={3}
      />
      <SetupField
        label="Preferred reminder time (24-hour HH:MM)"
        value={time}
        onChangeText={setTime}
        maxLength={5}
        placeholder="09:00"
        autoCapitalize="none"
      />
      <Notice>
        Saved on this device only. Automatic reminders and care logs will be
        added in the next implementation step.
      </Notice>
      <Action
        label={action.busy ? "Saving…" : "Save schedule & open my garden"}
        disabled={action.busy}
        onPress={() => void save()}
      />
    </SetupScreen>
  );
}

export default function CareSetup() {
  const local = useLocalState();
  const data = useAppData();
  const action = useSetupAction();
  const plant = data.plants.find((p) => p.id === local.data.onboarding.plantId);
  if (!plant)
    return (
      <SetupScreen
        title="Your plant's care schedule"
        subtitle="We need the selected plant before saving its care plan."
        progress="Ready to grow"
        back="plant"
        {...action}
      >
        <Notice>
          {data.loading
            ? "Loading your plant…"
            : data.error ||
              "The plant is unavailable. Go back to choose another plant."}
        </Notice>
        <Action
          label="Retry collection"
          onPress={() => void data.refresh()}
          disabled={data.loading}
        />
      </SetupScreen>
    );
  const light = local.data.spaces.find((s) => s.name === plant.location)?.light;
  const initial =
    local.data.schedules[plant.id] ??
    suggestedCareSchedule(plant.id, plant.species, light);
  return <CareForm key={plant.id} plantName={plant.name} initial={initial} />;
}
