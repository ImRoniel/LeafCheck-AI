import type { PreScanAdapters, PreScanReason, PreScanResult } from "../types/pre-scan-validation";

export const VALIDATION_BUDGET_MS = 200;
// Conservative policy threshold; calibrate on captured plant/screen/print images.
export const REPRODUCTION_THRESHOLD = 0.9;
const guidance: Record<PreScanReason, string> = {
  ok: "",
  blur: "Hold your phone steady and focus on the leaves, then try another photo.",
  underexposed: "Move your plant into brighter indirect light, then try another photo.",
  overexposed: "Avoid glare or direct light on the leaves, then try another photo.",
  screen: "Point the camera at a real plant, not a phone or tablet screen.",
  printed_photo: "Point the camera at a real plant, not a printed photo.",
  invalid_image: "We couldn’t check this photo. Please take another photo.",
  validation_unavailable: "Photo checks aren’t available in this build. Use an updated development build with plant photo checks installed.",
  validation_timeout: "Checking your photo took too long. Please try another photo.",
  cancelled: "Photo check cancelled. Please take another photo.",
};
export const validationResult = (reason: PreScanReason): PreScanResult => ({
  valid: reason === "ok", reason, guidance: guidance[reason],
});
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Only local file URLs; the scanner supplies the URI returned by its own capture. */
export function localImagePath(uri: string): string | null {
  if (typeof uri !== "string" || !uri.startsWith("file:///")) return null;
  try {
    const path = decodeURIComponent(uri.slice("file://".length));
    if (/[\u0000-\u001f?#\\]/.test(path) || path.split("/").some(part => part === ".." || part === ".")) return null;
    return path.length > 1 ? path : null;
  } catch { return null; }
}

/** Guards package/native results before using its flags. Quality failure wins over semantics. */
export function qualityReason(value: unknown): PreScanReason {
  if (!record(value) || !["isValid", "isBlurry", "isDark", "isWhite"].every(key => typeof value[key] === "boolean"))
    return "invalid_image";
  for (const key of ["blurScore", "sharpEdgeRatio", "tenengradScore", "meanLuminance", "stdDevLuminance", "overexposedRatio", "underexposedRatio"]) {
    if (!finite(value[key]) || value[key] < 0) return "invalid_image";
  }
  if ((value.meanLuminance as number) > 255 || (value.overexposedRatio as number) > 1
    || (value.underexposedRatio as number) > 1 || (value.sharpEdgeRatio as number) > 1) return "invalid_image";
  if (value.isBlurry) return "blur";
  if (value.isDark) return "underexposed";
  if (value.isWhite) return "overexposed";
  return value.isValid ? "ok" : "invalid_image";
}

/** Classifier returns normalized scores for the photographed subject, not nearby objects. */
export function reproductionReason(value: unknown): PreScanReason {
  if (!record(value)) return "invalid_image";
  const { real, screen, printed_photo: print } = value;
  if (![real, screen, print].every(score => finite(score) && score >= 0 && score <= 1)) return "invalid_image";
  if (!finite(real) || !finite(screen) || !finite(print) || Math.abs(real + screen + print - 1) > 0.001) return "invalid_image";
  if (screen >= REPRODUCTION_THRESHOLD && screen > real && screen >= print) return "screen";
  if (print >= REPRODUCTION_THRESHOLD && print > real && print > screen) return "printed_photo";
  return "ok";
}

export function createPreScanValidator(
  adapters: PreScanAdapters,
  options: { budgetMs?: number; now?: () => number } = {},
) {
  const budget = options.budgetMs ?? VALIDATION_BUDGET_MS;
  if (!Number.isFinite(budget) || budget <= 0 || budget > VALIDATION_BUDGET_MS) throw new Error("Invalid validation budget");
  const now = options.now ?? (() => performance.now());
  // A timed-out/aborted native promise can still be running. Keep its slot until it settles.
  let nativeBusy = false;
  return async (uri: string, signal?: AbortSignal): Promise<PreScanResult> => {
    if (signal?.aborted) return validationResult("cancelled");
    if (!localImagePath(uri)) return validationResult("invalid_image");
    if (nativeBusy) return {
      ...validationResult("validation_unavailable"),
      guidance: "The previous photo check is still finishing. Please try again in a moment.",
    };
    nativeBusy = true;
    const start = now();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stopped = (): PreScanReason | null => signal?.aborted ? "cancelled"
      : expired || now() - start >= budget ? "validation_timeout" : null;
    const stopPromise = new Promise<PreScanResult>(resolve => {
      timer = setTimeout(() => { expired = true; resolve(validationResult("validation_timeout")); }, budget);
      abort = () => resolve(validationResult("cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
    });
    const work = (async (): Promise<PreScanResult> => {
      try {
        const quality = qualityReason(await adapters.analyzeQuality(uri));
        const afterQuality = stopped();
        if (afterQuality) return validationResult(afterQuality);
        if (quality !== "ok") return validationResult(quality);
        const semantic = reproductionReason(await adapters.detectReproduction(uri));
        return validationResult(stopped() ?? semantic);
      } catch {
        return validationResult(stopped() ?? "validation_unavailable");
      } finally {
        nativeBusy = false;
      }
    })();
    try { return await Promise.race([work, stopPromise]); }
    finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
    }
  };
}
