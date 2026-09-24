import { Action, ui } from "@/components/screen";
import {
    SetupChoice,
    SetupField,
    SetupScreen,
    useSetupAction,
} from "@/components/setup-screen";
import { useLocalState } from "@/context/local-state";
import type { RoomLight, SpaceTheme } from "@/types/local-state";
import { useState } from "react";
import { Text } from "react-native";

export default function SpaceSetup() {
  const local = useLocalState();
  const existing = local.data.spaces.find(
    (s) => s.id === local.data.onboarding.spaceId,
  );
  const [name, setName] = useState(existing?.name ?? "Bedroom");
  const [theme, setTheme] = useState<SpaceTheme>(existing?.theme ?? "bedroom");
  const [light, setLight] = useState<RoomLight>(existing?.light ?? "medium");
  const action = useSetupAction();
  const save = () =>
    action.run(async () => {
      if (!name.trim()) throw new Error("Give your space a name.");
      await local.update((state) => {
        const match = state.spaces.find(
          (s) => s.name.toLowerCase() === name.trim().toLowerCase(),
        );
        // Reuse same-name metadata; never rename a server-backed location implicitly.
        const space = {
          id:
            match?.id ??
            `space-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: match?.name ?? name.trim(),
          theme,
          light,
          createdAt: match?.createdAt ?? new Date().toISOString(),
        };
        return {
          ...state,
          spaces: [...state.spaces.filter((s) => s.id !== space.id), space],
          onboarding: { ...state.onboarding, spaceId: space.id, step: "plant" },
        };
      });
    });
  return (
    <SetupScreen
      title="Let's create your first space"
      subtitle="A space is a room or area in your home. It can be empty while you get started."
      progress="Setup 2 of 3"
      back="experience"
      {...action}
    >
      <SetupField
        label="Space name"
        value={name}
        onChangeText={setName}
        maxLength={100}
        placeholder="Bedroom"
      />
      <Text style={ui.heading}>Pick a room theme</Text>
      {(
        [
          ["living", "Living room"],
          ["kitchen", "Kitchen"],
          ["bedroom", "Bedroom"],
          ["balcony", "Balcony"],
        ] as const
      ).map(([value, label]) => (
        <SetupChoice
          key={value}
          title={label}
          selected={theme === value}
          onPress={() => setTheme(value)}
        />
      ))}
      <Text style={ui.heading}>How much light does this room get?</Text>
      {(["low", "medium", "high"] as const).map((value) => (
        <SetupChoice
          key={value}
          title={value[0].toUpperCase() + value.slice(1)}
          selected={light === value}
          onPress={() => setLight(value)}
        />
      ))}
      <Action
        label={action.busy ? "Saving…" : "Continue"}
        disabled={!name.trim() || action.busy}
        onPress={() => void save()}
      />
    </SetupScreen>
  );
}
