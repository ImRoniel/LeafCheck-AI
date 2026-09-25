// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Pl@ntNet API Client
//
// Identifies plant species from a base64-encoded leaf/plant image.
// API docs: https://my.plantnet.org/doc/openapi
// ─────────────────────────────────────────────────────────────────────────────

import type { PlantIdentificationResult } from "../types/scan.js";
import { HttpError } from "./http.js";

const PLANTNET_BASE_URL = "https://my-api.plantnet.org/v2/identify/all";

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
  if (!apiKey) {
    throw new HttpError(
      503,
      "PLANT_IDENTIFICATION_FAILED",
      "Plant identification is temporarily unavailable.",
    );
  }

  // Convert base64 → binary Blob for multipart upload
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: "image/jpeg" });

  const formData = new FormData();
  formData.append("images", blob, "plant.jpg");
  formData.append("organs", "leaf");

  const url = `${PLANTNET_BASE_URL}?include-related-images=false&no-reject=false&lang=en&api-key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {
    throw new HttpError(
      502,
      "PLANT_IDENTIFICATION_FAILED",
      "Plant identification is temporarily unavailable.",
    );
  });

  if (!response.ok) {
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

  const data = (await response.json()) as {
    results?: {
      score?: number;
      species?: {
        scientificNameWithoutAuthor?: string;
        commonNames?: string[];
      };
    }[];
  };

  const topResult = data?.results?.[0];
  if (!topResult || !topResult.species?.scientificNameWithoutAuthor?.trim()) {
    throw new HttpError(
      422,
      "NO_PLANT_DETECTED",
      "We couldn't detect a plant in this photo. Please center the leaves or flowers in bright light and try again.",
    );
  }

  return {
    speciesName:
      topResult.species?.scientificNameWithoutAuthor ?? "Unknown species",
    commonName: topResult.species?.commonNames?.[0] ?? null,
    confidence: topResult.score ?? 0,
    rawResponse: data,
  };
}
