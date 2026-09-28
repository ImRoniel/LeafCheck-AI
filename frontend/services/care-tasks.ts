import type { CareCompletion, GardenCareTask } from "../types/care-task";
import type { CareSchedule, LocalState } from "../types/local-state";
import type { Plant } from "../types/plant";
import type { CareTask } from "../types/scan";

/** Calendar-day arithmetic preserves the user's reminder time across DST. */
function nextReminder(anchor: string, days: number, time: string): string {
  const due = new Date(anchor);
  const [hours, minutes] = time.split(":").map(Number);
  due.setDate(due.getDate() + days);
  due.setHours(hours, minutes, 0, 0);
  return due.toISOString();
}

export function buildCareTasks(
  plants: readonly Plant[],
  schedules: Record<string, CareSchedule>,
  completions: readonly CareCompletion[],
  now = new Date(),
  serverTasks: readonly CareTask[] = [],
) {
  const tasks: GardenCareTask[] = [];
  const completedIds = new Set(completions.map((item) => item.id));
  const serverCompleted: CareCompletion[] = [];
  const plantIds = new Set(plants.map((plant) => plant.id));
  for (const task of serverTasks) {
    if (!plantIds.has(task.plantId) || task.status === "SKIPPED") continue;
    const item: GardenCareTask = {
      id: `server:${task.id}`,
      key: `server:${task.id}`,
      serverId: task.id,
      plantId: task.plantId,
      title: task.title,
      details: task.description ?? "Saved scan care task.",
      dueAt: task.dueDate,
      priority: task.urgency === "routine" ? "routine" : "immediate",
    };
    if (task.status === "COMPLETED") {
      if (task.completedAt)
        serverCompleted.push({ ...item, completedAt: task.completedAt });
    } else if (task.status === "PENDING") tasks.push(item);
  }
  for (const plant of plants) {
    const add = (
      kind: string,
      title: string,
      details: string,
      priority: GardenCareTask["priority"],
    ) => {
      const key = JSON.stringify([
        plant.id,
        kind,
        plant.lastScannedAt ?? plant.updatedAt,
      ]);
      tasks.push({
        id: key,
        key,
        plantId: plant.id,
        title,
        details,
        priority,
        dueAt: null,
      });
    };
    if (!plant.lastScannedAt && !plant.id.startsWith("guest-"))
      add(
        "photo",
        "Scan actual plant image",
        "Open this plant and choose Scan this plant. No sensor is required.",
        "immediate",
      );
    if (plant.healthStatus === "warning" || plant.healthStatus === "critical") {
      add(
        "health",
        "Inspect plant health",
        `Last saved status: ${plant.healthStatus}. Inspect the leaves and review this plant before taking action. This is not a live sensor alert.`,
        "immediate",
      );
    }
    for (const recommendation of plant.recommendations ?? []) {
      if (!recommendation.action.trim()) continue;
      add(
        JSON.stringify([
          recommendation.action,
          recommendation.details,
          recommendation.urgency,
        ]),
        recommendation.action,
        `Saved recommendation: ${recommendation.details}`,
        recommendation.urgency === "routine" ? "routine" : "immediate",
      );
    }
    const schedule = schedules[plant.id];
    if (!schedule) {
      add(
        "moisture",
        "Check soil moisture",
        "Manual check: feel the soil and review the plant's needs before watering. No watering schedule is saved.",
        "routine",
      );
      add(
        "light",
        "Check light conditions",
        "Review the plant's placement and leaf condition. This is a manual check, not a sensor reading.",
        "routine",
      );
      continue;
    }
    const recurring = [
      [
        "water",
        "Check soil moisture / watering",
        `Saved preference: ${schedule.waterMl} ml every ${schedule.wateringDays} days. Check soil first; water only if needed.`,
        schedule.wateringDays,
      ],
      [
        "fertilize",
        "Review fertilizing",
        `Saved preference: ${schedule.fertilizer}, every ${schedule.fertilizingDays} days. Follow the product instructions.`,
        schedule.fertilizingDays,
      ],
      [
        "light",
        "Check light / rotate plant",
        `Review light and rotate if needed, every ${schedule.rotationDays} days. Manual check, not a live reading.`,
        schedule.rotationDays,
      ],
    ] as const;
    for (const [kind, title, details, days] of recurring) {
      const key = JSON.stringify([plant.id, kind, schedule.updatedAt]);
      const latest = completions
        .filter((item) => item.key === key)
        .sort(
          (a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
        )[0];
      const dueAt = nextReminder(
        latest?.completedAt ?? schedule.updatedAt,
        days,
        schedule.reminderTime,
      );
      tasks.push({
        id: JSON.stringify([key, dueAt]),
        key,
        plantId: plant.id,
        title,
        details,
        priority: "routine",
        dueAt,
      });
    }
  }
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const pending = [...new Map(tasks.map((task) => [task.id, task])).values()]
    .filter((task) => !completedIds.has(task.id))
    .sort(
      (a, b) =>
        (a.priority === b.priority ? 0 : a.priority === "immediate" ? -1 : 1) ||
        (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
          (b.dueAt ? Date.parse(b.dueAt) : Infinity),
    );
  const immediate = (task: GardenCareTask) =>
    task.priority === "immediate" ||
    (task.dueAt !== null && Date.parse(task.dueAt) <= endOfDay.getTime());
  return {
    today: pending.filter(immediate),
    upcoming: pending.filter((task) => !immediate(task)),
    completed: [...completions, ...serverCompleted]
      .filter((item) => plantIds.has(item.plantId))
      .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
      .slice(0, 50),
  };
}

export function completeCareTask(
  state: LocalState,
  task: GardenCareTask,
  now = new Date(),
): LocalState {
  if (state.careCompletions.some((item) => item.id === task.id)) return state;
  return {
    ...state,
    careCompletions: [
      { ...task, completedAt: now.toISOString() },
      ...state.careCompletions,
    ].slice(0, 500),
  };
}

export function undoCareTask(state: LocalState, id: string): LocalState {
  return {
    ...state,
    careCompletions: state.careCompletions.filter((item) => item.id !== id),
  };
}
