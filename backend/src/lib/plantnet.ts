// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Pl@ntNet API Client
//
// Identifies plant species from a base64-encoded leaf/plant image.
// API docs: https://my.plantnet.org/doc/openapi
// ─────────────────────────────────────────────────────────────────────────────

import type { PlantIdentificationResult } from "../types/scan.js";

const PLANTNET_BASE_URL =
  "https://my-api.plantnet.org/v2/identify/all";

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
  const apiKey = process.env.PLANTNET_API_KEY;
  if (!apiKey) {
    throw new Error(
      "PLANTNET_API_KEY is not configured. Set it in your .env file.",
    );
  }

  // Convert base64 → binary Blob for multipart upload
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const blob = new Blob([imageBuffer], { type: "image/jpeg" });

  const formData = new FormData();
  formData.append("images", blob, "plant.jpg");
  formData.append("organs", "leaf");

  const url = `${PLANTNET_BASE_URL}?include-related-images=false&no-reject=false&lang=en&api-key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Pl@ntNet API error (${response.status}): ${errorBody}`,
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

  const topResult = data.results?.[0];
  if (!topResult) {
    throw new Error(
      "Pl@ntNet could not identify the plant. Try a clearer image of the leaves.",
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
