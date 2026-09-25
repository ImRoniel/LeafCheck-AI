// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Perenual API Client
//
// Fetches ideal environmental specs for a plant species by scientific name.
// API docs: https://perenual.com/docs/api
// ─────────────────────────────────────────────────────────────────────────────

import type { PlantSpecData } from "../types/scan.js";

const PERENUAL_BASE_URL = "https://perenual.com/api/v2/species-list";

/**
 * Queries the Perenual API for a species and normalizes the response into
 * a PlantSpecData object suitable for PostgreSQL PlantSpecCache insertion.
 *
 * @returns Normalized spec data, or `null` if the API key is missing,
 *          the request fails, or no matching species is found.
 */
export async function fetchPlantSpecs(
  speciesName: string,
  commonNameQuery?: string | null,
): Promise<PlantSpecData | null> {
  const apiKey = process.env.PERENUAL_API_KEY;
  if (!apiKey) {
    console.warn(
      "[Perenual] PERENUAL_API_KEY is not configured — skipping spec lookup.",
    );
    return null;
  }

  try {
    const queries = [
      ...new Set(
        [speciesName, commonNameQuery].filter((q): q is string => !!q?.trim()),
      ),
    ];
    // A shared deadline bounds the entire optional enrichment stage.
    const signal = AbortSignal.timeout(10_000);
    for (const query of queries) {
      const url = `${PERENUAL_BASE_URL}?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { signal });

      if (!response.ok) {
        console.warn(
          `[Perenual] Lookup unavailable (${response.status}); continuing without specs.`,
        );
        return null;
      }

      const data = (await response.json()) as {
        data?: Array<{
          scientific_name?: string | string[];
          common_name?: string | string[];
          sunlight?: string | string[];
          watering?: string;
          hardiness?: { min_temp_c?: number; max_temp_c?: number };
          soil_ph?: { min?: number; max?: number };
        }>;
      };

      // Common names can refer to unrelated plants. Never cache the first fuzzy
      // result as authoritative specs for the identified species.
      const normalize = (name: string) =>
        name.trim().toLowerCase().replace(/\s+/g, " ");
      const species = Array.isArray(data?.data)
        ? data.data.find((candidate) => {
            const names = Array.isArray(candidate?.scientific_name)
              ? candidate.scientific_name
              : [candidate?.scientific_name];
            return names.some(
              (name) =>
                typeof name === "string" &&
                normalize(name) === normalize(speciesName),
            );
          })
        : undefined;
      if (!species) {
        console.warn(`[Perenual] No results found for "${speciesName}".`);
        continue;
      }

      // Map sunlight description → approximate lux range
      const sunlightDesc = Array.isArray(species.sunlight)
        ? species.sunlight.join(", ")
        : (species.sunlight ?? null);
      const { luxMin, luxMax } = mapSunlightToLux(sunlightDesc);

      // Normalize common_name (can be string or string[])
      const commonName = Array.isArray(species.common_name)
        ? (species.common_name[0] ?? null)
        : (species.common_name ?? null);

      return {
        speciesName,
        commonName,
        idealLuxMin: luxMin,
        idealLuxMax: luxMax,
        idealTempMinC: species.hardiness?.min_temp_c ?? null,
        idealTempMaxC: species.hardiness?.max_temp_c ?? null,
        idealHumidityMin: null, // Perenual does not provide humidity ranges
        idealHumidityMax: null,
        idealPhMin: species.soil_ph?.min ?? null,
        idealPhMax: species.soil_ph?.max ?? null,
        wateringFrequency: species.watering ?? null,
        sunlight: sunlightDesc,
        rawJson: species,
      };
    }
    return null;
  } catch {
    console.warn("[Perenual] Lookup failed; continuing without specs.");
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Rough mapping from Perenual sunlight descriptions to lux ranges.
 * These are approximate and sufficient for diagnostic comparisons.
 */
function mapSunlightToLux(desc: string | null): {
  luxMin: number | null;
  luxMax: number | null;
} {
  if (!desc) return { luxMin: null, luxMax: null };

  const lower = desc.toLowerCase();
  if (lower.includes("full sun")) return { luxMin: 25_000, luxMax: 100_000 };
  if (lower.includes("part shade") || lower.includes("partial"))
    return { luxMin: 10_000, luxMax: 25_000 };
  if (lower.includes("full shade") || lower.includes("low light"))
    return { luxMin: 500, luxMax: 10_000 };

  // Default for "indirect" or unrecognized descriptions
  if (lower.includes("indirect")) return { luxMin: 5_000, luxMax: 20_000 };

  return { luxMin: null, luxMax: null };
}
