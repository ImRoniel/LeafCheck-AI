import type { CareCompletion, GardenCareTask } from "../types/care-task";

/** Calendar-day totals include today's overdue tasks; undated checks are never due today. */
export function tasksDueToday<T extends GardenCareTask | CareCompletion>(tasks: readonly T[], now: Date): T[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return tasks.filter(task => !("completedAt" in task) && !!task.dueAt &&
    Date.parse(task.dueAt) >= start.getTime() && Date.parse(task.dueAt) < end.getTime());
}

/** A short first sentence keeps the list scannable; the full saved details remain expandable. */
export function careTaskPreview(details: string): string {
  const text = details.trim();
  if (text.length <= 96) return text;
  const first = text.match(/^(.{1,96}?[.!?])(?:\s|$)/)?.[1];
  return first ?? `${text.slice(0, 93).trim()}…`;
}
