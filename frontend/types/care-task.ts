export interface GardenCareTask {
  id: string;
  /** Stable across occurrences; changes when the underlying care plan changes. */
  key: string;
  plantId: string;
  title: string;
  details: string;
  dueAt: string | null;
  priority: "immediate" | "routine";
  serverId?: string;
}

export interface CareCompletion extends GardenCareTask {
  completedAt: string;
}
