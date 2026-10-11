import type { CareTask } from "../types";

export function timestampMillis(value: unknown): number | null {
  const millis = value instanceof Date ? value.getTime()
    : typeof value === "string" && value.trim() ? Date.parse(value)
    : typeof value === "number" ? value : NaN;
  return Number.isFinite(millis) ? millis : null;
}

export function hasNewerTelemetry(telemetryTimestamp: unknown, diagnosisTimestamp: unknown): boolean {
  const reading = timestampMillis(telemetryTimestamp);
  const diagnosis = timestampMillis(diagnosisTimestamp);
  return reading !== null && (diagnosis === null || reading > diagnosis);
}

/** Match setup actions narrowly; sensor maintenance and calibration remain care tasks. */
export function isSensorSetupAction(text: string): boolean {
  return /\b(?:install|connect|pair|set\s*up)\b.{0,45}\b(?:environmental\s+)?sensors?\b/i.test(text);
}

export function profileCareTasks(tasks: readonly CareTask[]) {
  return tasks.filter(task => !isSensorSetupAction(task.title))
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
}

/** Format saved content locally; never invent recommendations from unrelated scans. */
export function diagnosisPresentation(raw: string) {
  const lines = raw.split(/\r?\n/);
  const recommendations: string[] = [];
  const report: string[] = [];
  let inRecommendations = false;
  let skippingSetup = false;
  for (const line of lines) {
    const clean = line.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").trim();
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/.test(line);
    if (isSensorSetupAction(clean)) { skippingSetup = true; continue; }
    if (skippingSetup && line.trim() && /^\s+/.test(line) && !bullet) continue;
    skippingSetup = false;
    if (/^(?:care\s+)?recommendations\s*:?$/i.test(clean)) inRecommendations = true;
    else if (/^\s*#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*\s*:?\s*$/.test(line)) inRecommendations = false;
    if (inRecommendations && bullet && clean) recommendations.push(clean.replace(/^(?:[-*•]|\d+[.)])\s+/, ""));
    report.push(line);
  }
  return { text: report.join("\n").trim(), recommendations: [...new Set(recommendations)] };
}
