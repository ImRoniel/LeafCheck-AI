import type { CareCompletion, GardenCareTask } from "../types/care-task";

export const careTaskPeriods = ["All dates", "Today", "This Week", "Next Week", "Later"] as const;
export type CareTaskPeriod = typeof careTaskPeriods[number];

/** Local calendar weeks start on Monday. This week includes overdue tasks; dated filters exclude undated checks. */
export function filterCareTaskPeriod<T extends GardenCareTask | CareCompletion>(tasks: readonly T[], period: CareTaskPeriod, now: Date): T[] {
  if (period === "All dates") return [...tasks];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextMonday = new Date(now);
  nextMonday.setHours(0, 0, 0, 0);
  nextMonday.setDate(nextMonday.getDate() + (7 - (nextMonday.getDay() + 6) % 7));
  const followingMonday = new Date(nextMonday);
  followingMonday.setDate(followingMonday.getDate() + 7);
  return tasks.filter(task => {
    const raw = "completedAt" in task ? task.completedAt : task.dueAt;
    if (!raw) return false;
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) return false;
    if (period === "Today") return timestamp >= start.getTime() && timestamp < tomorrow.getTime();
    if (period === "This Week") return timestamp < nextMonday.getTime();
    if (period === "Next Week") return timestamp >= nextMonday.getTime() && timestamp < followingMonday.getTime();
    return timestamp >= followingMonday.getTime();
  });
}
