import { Action } from "@/components/screen";
import {
    SetupChoice,
    SetupScreen,
    useSetupAction,
} from "@/components/setup-screen";
import { useLocalState } from "@/context/local-state";
import type { ExperienceLevel } from "@/types/local-state";
import { useState } from "react";

export default function ExperienceSetup() {
  const local = useLocalState();
  const [experience, setExperience] = useState<ExperienceLevel | null>(
    local.data.experience,
  );
  const action = useSetupAction();
  return (
    <SetupScreen
      title="How would you describe yourself?"
      subtitle="A little about you helps us offer the right amount of guidance."
      progress="Setup 1 of 3"
      {...action}
    >
      <SetupChoice
        title="I'm brand new to plants"
        description="I've lost a few. I'd like gentle guidance."
        selected={experience === "beginner"}
        onPress={() => setExperience("beginner")}
      />
      <SetupChoice
        title="I have a few plants"
        description="I want to understand them and do better."
        selected={experience === "intermediate"}
        onPress={() => setExperience("intermediate")}
      />
      <SetupChoice
        title="I'm experienced"
        description="Help me organize care and follow the data."
        selected={experience === "experienced"}
        onPress={() => setExperience("experienced")}
      />
      <Action
        label={action.busy ? "Saving…" : "Continue"}
        disabled={!experience || action.busy}
        onPress={() =>
          void action.run(() =>
            local.update((state) => ({
              ...state,
              experience,
              onboarding: { ...state.onboarding, step: "space" },
            })),
          )
        }
      />
    </SetupScreen>
  );
}
