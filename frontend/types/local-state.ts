import type { Plant } from "./plant";

export type ExperienceLevel = "beginner" | "intermediate" | "experienced";
export type SpaceTheme = "living" | "kitchen" | "bedroom" | "balcony";
export type RoomLight = "low" | "medium" | "high";
export type SetupStep =
  | "experience"
  | "space"
  | "plant"
  | "sensor-choice"
  | "care";

export interface LocalSpace {
  id: string;
  name: string;
  theme: SpaceTheme;
  light: RoomLight;
  createdAt: string;
}

export interface CareSchedule {
  plantId: string;
  wateringDays: number;
  waterMl: number;
  fertilizingDays: number;
  fertilizer: string;
  rotationDays: number;
  reminderTime: string;
  updatedAt: string;
}

export interface LocalState {
  version: 1;
  experience: ExperienceLevel | null;
  spaces: LocalSpace[];
  guestPlants: Plant[];
  schedules: Record<string, CareSchedule>;
  onboarding: {
    status: "pending" | "completed" | "skipped";
    step: SetupStep;
    spaceId: string | null;
    plantId: string | null;
    mode: "manual" | null;
  };
}

export const setupSteps: readonly SetupStep[] = [
  "experience",
  "space",
  "plant",
  "sensor-choice",
  "care",
];

export function initialLocalState(): LocalState {
  return {
    version: 1,
    experience: null,
    spaces: [],
    guestPlants: [],
    schedules: {},
    onboarding: {
      status: "pending",
      step: "experience",
      spaceId: null,
      plantId: null,
      mode: null,
    },
  };
}
