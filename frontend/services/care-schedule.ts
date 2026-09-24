import type { CareSchedule, RoomLight } from "../types/local-state";

/** Editable planning defaults, not measured moisture or an instruction to water. */
export function suggestedCareSchedule(
  plantId: string,
  species: string,
  light: RoomLight = "medium",
): CareSchedule {
  const baseDays = /dracaena|sansevieria|snake/i.test(species)
    ? 21
    : /monstera|epipremnum|pothos/i.test(species)
      ? 10
      : 7;
  return {
    plantId,
    wateringDays: baseDays + (light === "low" ? 3 : light === "high" ? -2 : 0),
    waterMl: 350,
    fertilizingDays: 30,
    fertilizer: "Balanced houseplant fertilizer — follow label",
    rotationDays: 14,
    reminderTime: "09:00",
    updatedAt: new Date().toISOString(),
  };
}

export function scheduleInputError(schedule: CareSchedule): string | null {
  const intervals = [
    schedule.wateringDays,
    schedule.fertilizingDays,
    schedule.rotationDays,
  ];
  if (intervals.some((n) => !Number.isInteger(n) || n < 1 || n > 365))
    return "Enter whole-day intervals between 1 and 365.";
  if (
    !Number.isInteger(schedule.waterMl) ||
    schedule.waterMl < 1 ||
    schedule.waterMl > 10000
  )
    return "Enter an amount between 1 and 10,000 ml.";
  if (!schedule.fertilizer.trim() || schedule.fertilizer.length > 100)
    return "Enter a fertilizer description of at most 100 characters.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.reminderTime))
    return "Use a 24-hour reminder time such as 09:00 or 18:30.";
  return null;
}
