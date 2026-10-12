// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Pl@ntNet API Client
//
// Identifies plant species from a base64-encoded leaf/plant image.
// API docs: https://my.plantnet.org/doc/openapi
// ─────────────────────────────────────────────────────────────────────────────

import type { PlantIdentificationResult } from "../types/scan.js";
import { HttpError } from "./http.js";

const PLANTNET_BASE_URL = "https://my-api.plantnet.org/v2/identify/all";
export const PLANTNET_TIMEOUT_MS = 8_000;
export const MAX_PLANTNET_IMAGE_BYTES = 1_000_000;

/** The original scan stays intact for Gemini and profile-photo storage. */
export async function preparePlantNetImage(imageBase64: string): Promise<Buffer> {
  // A missing native codec must fail this optional attempt, never server startup.
  const { default: sharp } = await import("sharp");
  const image = await sharp(Buffer.from(imageBase64, "base64"), { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80, chromaSubsampling: "4:2:0" })
    .timeout({ seconds: PLANTNET_TIMEOUT_MS / 1000 })
    .toBuffer();
  if (image.length >= MAX_PLANTNET_IMAGE_BYTES) {
    throw new HttpError(413, "PLANT_IDENTIFICATION_IMAGE_TOO_LARGE", "Plant identification is temporarily unavailable.");
  }
  return image;
}

/**
 * Sends a plant image to the Pl@ntNet API and returns the top identification.
 *
 * @param imageBase64 - Base64-encoded JPEG image data (no data URI prefix).
 * @returns The top species match with confidence score.
 * @throws If the API key is missing, the request fails, or no match is found.
 */
export async function identifyPlant(
  imageBase64: string,
): Promise<PlantIdentificationResult> {
  const apiKey = process.env.PLANTNET_API_KEY?.trim();
  if (!apiKey || /\s/.test(apiKey)) {
    throw new HttpError(
      503,
      "PLANT_IDENTIFICATION_FAILED",
      "Plant identification is temporarily unavailable.",
    );
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new HttpError(504, "PLANT_IDENTIFICATION_TIMEOUT", "Plant identification timed out.");
      reject(error);
      controller.abort(error);
    }, PLANTNET_TIMEOUT_MS);
  });
  try {
    // Bound resizing, upload and response parsing, even if an upstream ignores abort.
    return await Promise.race([identifyWithinDeadline(imageBase64, apiKey, controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function identifyWithinDeadline(imageBase64: string, apiKey: string, signal: AbortSignal): Promise<PlantIdentificationResult> {

  // Convert base64 → binary Blob for multipart upload
  const imageBuffer = await preparePlantNetImage(imageBase64);
  signal.throwIfAborted();
  const blob = new Blob([Uint8Array.from(imageBuffer)], { type: "image/jpeg" });

  const formData = new FormData();
  formData.append("images", blob, "plant.jpg");
  formData.append("organs", "leaf");

  const url = `${PLANTNET_BASE_URL}?include-related-images=false&no-reject=false&lang=en&api-key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    signal,
  }).catch(() => {
    throw new HttpError(
      502,
      "PLANT_IDENTIFICATION_FAILED",
      "Plant identification is temporarily unavailable.",
    );
  });

  if (!response.ok) {
    console.warn("[Pl@ntNet] Provider unavailable", { status: response.status });
    let errorDetail = "";
    try {
      const errJson = JSON.parse(await response.text());
      const detail = errJson?.message || errJson?.error;
      errorDetail = typeof detail === "string" ? detail : "";
    } catch {
      // ignore
    }
    if (
      response.status === 404 ||
      errorDetail.toLowerCase().includes("not found")
    ) {
      throw new HttpError(
        422,
        "NO_PLANT_DETECTED",
        "We couldn't detect a plant in this photo. Please center the leaves or flowers in bright light and try again.",
      );
    }
    throw new HttpError(
      502,
      "PLANT_IDENTIFICATION_FAILED",
      "Unable to reach the plant identification service. Please check your internet connection and try again.",
    );
  }

  const unavailable = () => new HttpError(502, "PLANT_IDENTIFICATION_FAILED", "Plant identification is temporarily unavailable.");
  const data: unknown = await response.json().catch(() => { throw unavailable(); });
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (!record(data) || !Array.isArray(data.results)) throw unavailable();
  const topResult: unknown = data.results[0];
  const species = record(topResult) && record(topResult.species) ? topResult.species : null;
  const speciesName = species?.scientificNameWithoutAuthor;
  if (topResult === undefined || speciesName === undefined || speciesName === "") {
    throw new HttpError(
      422,
      "NO_PLANT_DETECTED",
      "We couldn't detect a plant in this photo. Please center the leaves or flowers in bright light and try again.",
    );
  }

  if (
    !record(topResult) || typeof speciesName !== "string" ||
    !speciesName.trim() || speciesName.length > 200 ||
    (topResult.score !== undefined && (typeof topResult.score !== "number" || !Number.isFinite(topResult.score) || topResult.score < 0 || topResult.score > 1)) ||
    (species?.commonNames !== undefined && (!Array.isArray(species.commonNames) || species.commonNames.some((name: unknown) => typeof name !== "string" || name.length > 200)))
  ) throw unavailable();
  const commonNames = species?.commonNames;

  return {
    speciesName: speciesName.trim(),
    commonName: Array.isArray(commonNames) && typeof commonNames[0] === "string" ? commonNames[0].trim() || null : null,
    confidence: typeof topResult.score === "number" ? topResult.score : 0,
    rawResponse: data,
  };
}
