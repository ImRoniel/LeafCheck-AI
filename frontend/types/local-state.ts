import type { CareCompletion } from "./care-task";
import type {
  ConnectedDevice,
  MockDeviceConnection,
} from "./device-connection";
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
  background?: string;
  status?: "archived" | "deleted";
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
  profile?: { name?: string; photoUri?: string };
  experience: ExperienceLevel | null;
  spaces: LocalSpace[];
  guestPlants: Plant[];
  schedules: Record<string, CareSchedule>;
  careCompletions: CareCompletion[];
  connectedDevices: ConnectedDevice[];
  /** Read-only legacy input; migrated by the persistence validator. */
  mockDeviceConnection?: MockDeviceConnection;
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
    careCompletions: [],
    connectedDevices: [],
    onboarding: {
      status: "pending",
      step: "experience",
      spaceId: null,
      plantId: null,
      mode: null,
    },
  };
}
