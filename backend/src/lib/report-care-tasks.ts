import { NaturalLanguageParserCore } from "tasknotes-nlp-core";
import type { CareTaskOutput } from "../types/scan.js";
import { HttpError } from "./http.js";

const parser = new NaturalLanguageParserCore([], [], false, "en", { triggers: [] });
const day = 24 * 60 * 60 * 1000;
const invalidReport = () => new HttpError(502, "SCAN_AI_UNAVAILABLE", "We couldn't complete your plant analysis. Please try again later.");
const heading = (line: string) => line.trim().replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/:$/, "").trim();
const actionStart = /^(?:(?:urgency|priority):\s*(?:routine|immediate|urgent)[.;:]?\s*)?(?:check|inspect|review|monitor|water|fertili[sz]e|prune|repot|move|rotate|remove|isolate|clean|wipe|adjust|reduce|increase|avoid|never|do not|don't)\b/i;

/** A fixed report section, not a classifier for arbitrary diagnosis prose. */
function actions(report: string): string[] {
  const lines = report.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => /^care actions$/i.test(heading(line)) ? [index] : []);
  if (starts.length !== 1) return [];
  const result: string[] = [];
  for (const line of lines.slice(starts[0]! + 1)) {
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet) result.push(bullet[1]!.trim());
    else if (/^\s{2,}\S/.test(line) && result.length) result[result.length - 1] += ` ${line.trim()}`;
    else break; // Next heading or prose is outside the action list.
  }
  return result;
}

function taskType(text: string): string {
  if (/^(?:do not|don't|avoid|never)\b/i.test(text)) return "OTHER";
  if (/^water\b/i.test(text)) return "WATERING";
  if (/^fertili[sz]e\b/i.test(text)) return "FERTILIZING";
  if (/^prune\b/i.test(text)) return "PRUNING";
  if (/^repot\b/i.test(text)) return "REPOTTING";
  if (/^(?:move|rotate|adjust)\b.*\b(?:light|sun|shade|window)\b/i.test(text)) return "LIGHT_ADJUSTMENT";
  if (/^(?:inspect|remove|isolate|wipe|clean)\b.*\b(?:pests?|mites?|mealybugs?|aphids?)\b/i.test(text)) return "PEST_CONTROL";
  return "OTHER";
}

/** Host policy: only explicit calendar dates are trusted, never chrono's ambient clock. */
function deadline(text: string, now: Date): { date: string; defaulted: boolean } {
  const fallback = { date: new Date(now.getTime() + day).toISOString(), defaulted: true };
  const dates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}))?(Z|\+00:00)|(?:\s+(?:at\s+)?(\d{2}:\d{2})(?:\s+UTC)?))?/g)];
  if (dates.length !== 1 || /\b(?:tomorrow|today|next|in \d+ days?|every)\b|\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(text)) return fallback;
  const date = dates[0]!;
  const iso = `${date[1]}T${date[2] ?? date[5] ?? "09:00"}:${date[3] ?? "00"}.000Z`;
  const due = new Date(iso);
  // Round trip rejects impossible calendar dates and out-of-range times.
  if (!Number.isFinite(due.getTime()) || due.toISOString() !== iso || due <= now) return fallback;
  // Reject partial matches to unsupported timezones or malformed explicit times.
  const after = text.slice(date.index! + date[0].length);
  if (/^(?:T|:|\s+(?:at\s+)?\d|\s*[+-]\d{2}:|\s*(?:a\.?m\.?|p\.?m\.?|GMT|PST|PDT|EST|EDT|CST|CDT|MST|MDT)\b)/i.test(after)) return fallback;
  return { date: iso, defaulted: false };
}

export function reportCareTasks(report: unknown, now = new Date()): CareTaskOutput[] {
  if (typeof report !== "string" || !report.trim() || report.length > 50_000 || !Number.isFinite(now.getTime())) throw invalidReport();
  const result: CareTaskOutput[] = [];
  const seen = new Set<string>();
  for (const raw of actions(report)) {
    const source = raw.replace(/\s+/g, " ").trim();
    if (source.length > 4800 || !actionStart.test(source)) continue;
    const urgencyMatch = source.match(/\b(?:urgency|priority):\s*(routine|immediate|urgent)\b/i);
    const urgency = urgencyMatch?.[1]?.toLowerCase() as CareTaskOutput["urgency"] | undefined;
    const instruction = source.replace(/\b(?:urgency|priority):\s*(?:routine|immediate|urgent)[.;:]?\s*/ig, "").trim();
    const key = instruction.toLowerCase();
    if (seen.has(key)) continue;
    // The actual library owns natural-language title cleanup; the complete source
    // remains in details so date/recurrence cleanup cannot erase care conditions.
    const parsed = parser.parseInput(instruction);
    const title = parsed.title.replace(/\s+/g, " ").replace(/[\s;,.-]+$/, "").trim();
    if (!title || title.length > 200 || !actionStart.test(title)) continue;
    const due = deadline(instruction, now);
    result.push({ title, taskType: taskType(instruction), description: source + (due.defaulted ? " Default reminder: 24 hours after the scan; the report did not provide a reliable future deadline." : ""), urgency: urgency ?? "routine", dueDate: due.date });
    seen.add(key);
    if (result.length === 5) break;
  }
  return result.length ? result : [{ title: "Review plant health", taskType: "OTHER", description: "Automatic care instructions could not be extracted. Review the saved diagnostic report. Default reminder: 24 hours after the scan.", urgency: "routine", dueDate: new Date(now.getTime() + day).toISOString() }];
}
