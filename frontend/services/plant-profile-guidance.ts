import type { CareTask, DiagnosisTelemetrySnapshot } from "../types";

export function telemetryIsFresh(timestamp: unknown, now = Date.now()): boolean {
  const reading = timestampMillis(timestamp);
  const age = reading === null ? NaN : now - reading;
  return Number.isFinite(age) && age >= -60_000 && age <= 30 * 60_000;
}

export function diagnosisBadgePresentation(snapshot: DiagnosisTelemetrySnapshot | null | undefined) {
  // Ownership at capture time is independent of freshness and today's pairing.
  switch (snapshot ? snapshot.source ?? "legacy" : "none") {
    case "current_session": return { label: "Sensor-Enhanced AI", backgroundColor: "#E8F5E9", color: "#278448" };
    case "historical_session": return { label: "Image + Older Sensor Readings", backgroundColor: "#FFF3D6", color: "#8B6914" };
    case "legacy": return { label: "Image-Only AI (legacy)", backgroundColor: "#F1F1F1", color: "#707770" };
    case "none": return { label: "Image-Only AI", backgroundColor: "#EEF2F0", color: "#43544B" };
  }
}

export function diagnosisBadgeLabel(snapshot: DiagnosisTelemetrySnapshot | null | undefined, _diagnosedAt?: unknown): string {
  return diagnosisBadgePresentation(snapshot).label;
}

export function identificationConfidenceLabel(confidence: number, reused = false): string {
  if (confidence === 0 && !reused) return "N/A";
  const percentage = confidence * 100;
  return `${percentage.toFixed(percentage > 0 && percentage < 0.1 ? 3 : 1)}%`;
}

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
