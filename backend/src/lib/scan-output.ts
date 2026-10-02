import type { GeminiStructuredOutput } from "../types/scan.js";
import { HttpError } from "./http.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const date = (value: unknown) =>
  typeof value === "string" && value.length <= 40 &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const taskTypes = ["WATERING", "FERTILIZING", "PRUNING", "REPOTTING", "PEST_CONTROL", "LIGHT_ADJUSTMENT", "OTHER"];

export function validateScanOutput(value: unknown): asserts value is GeminiStructuredOutput {
  if (
    !record(value) ||
    typeof value.healthStatus !== "string" || !["healthy", "warning", "critical"].includes(value.healthStatus) ||
    !text(value.diagnosticReport, 50_000) ||
    !Array.isArray(value.careTasks) || value.careTasks.length > 5 ||
    value.careTasks.some((task: unknown) =>
      !record(task) || !text(task.title, 200) || !text(task.description, 5000) ||
      typeof task.taskType !== "string" || !taskTypes.includes(task.taskType) ||
      typeof task.urgency !== "string" || !["routine", "immediate", "urgent"].includes(task.urgency) || !date(task.dueDate)
    ) ||
    !record(value.notification) || !date(value.notification.notifyAt) ||
    !text(value.notification.reason, 2000)
  ) {
    throw new HttpError(502, "SCAN_AI_UNAVAILABLE", "We couldn't complete your plant analysis. Please try again later.");
  }
}
