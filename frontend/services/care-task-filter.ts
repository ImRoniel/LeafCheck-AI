import type { CareCompletion, GardenCareTask } from "../types/care-task";

export const careTaskPeriods = ["This Week", "Next Week", "Later"] as const;
export type CareTaskPeriod = typeof careTaskPeriods[number];

/** Local calendar weeks start on Monday. Overdue and undated checks remain actionable. */
export function filterCareTaskPeriod<T extends GardenCareTask | CareCompletion>(tasks: readonly T[], period: CareTaskPeriod, now: Date): T[] {
  const nextMonday = new Date(now);
  nextMonday.setHours(0, 0, 0, 0);
  nextMonday.setDate(nextMonday.getDate() + (7 - (nextMonday.getDay() + 6) % 7));
  const followingMonday = new Date(nextMonday);
  followingMonday.setDate(followingMonday.getDate() + 7);
  return tasks.filter(task => {
    const raw = "completedAt" in task ? task.completedAt : task.dueAt;
    if (!raw) return period === "This Week";
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) return period === "This Week";
    if (period === "This Week") return timestamp < nextMonday.getTime();
    if (period === "Next Week") return timestamp >= nextMonday.getTime() && timestamp < followingMonday.getTime();
    return timestamp >= followingMonday.getTime();
  });
}
