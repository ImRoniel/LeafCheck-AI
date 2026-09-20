// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — AI Scanner Pipeline
//
// POST /api/scan
//
// Orchestrates the multi-step diagnostic flow:
//   1. Pl@ntNet  → identify species from image
//   2. Save      → PlantIdentification record in PostgreSQL
//   3. Parallel  → Promise.all([PlantSpecCache lookup, latest SensorReading])
//      3a. Cache miss → Perenual API fetch → insert PlantSpecCache
//      3b. MongoDB  → findFirst SensorReading for device
//   4. Freshness → calculate age of telemetry data
//   5. Gemini    → build prompt with ideal specs + actual readings + image
//   6. Save      → AIAnalysis record in PostgreSQL
//   7. Return    → diagnostic report to client
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Request, Response, Router } from "express";
import { fetchPlantSpecs } from "../lib/perenual.js";
import { identifyPlant } from "../lib/plantnet.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { prisma } from "../lib/prisma.js";
import type { ScanRequest } from "../types/scan.js";

export const scanRouter = Router();

// ─── Gemini Client ────────────────────────────────────────────────────────────

const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

// ─── POST /api/scan ───────────────────────────────────────────────────────────

scanRouter.post("/", async (req: Request, res: Response) => {
  const { imageBase64, plantId, deviceId } = req.body as ScanRequest;

  // ── Input Validation ──────────────────────────────────────────────────────
  if (!imageBase64 || typeof imageBase64 !== "string") {
    res
      .status(400)
      .json({ error: "imageBase64 is required (base64-encoded JPEG)." });
    return;
  }
  if (!plantId || typeof plantId !== "string") {
    res.status(400).json({ error: "plantId is required." });
    return;
  }
  if (!genAI) {
    res.status(503).json({
      error: "Gemini API key is not configured. Set GEMINI_API_KEY in .env.",
    });
    return;
  }

  try {
    // ── Step 1: Identify species via Pl@ntNet ─────────────────────────────
    console.log("[Scan] Step 1: Identifying species via Pl@ntNet...");
    const identification = await identifyPlant(imageBase64);
    console.log(
      "[Scan] Identified: %s (%s) — confidence: %s%%",
      identification.speciesName,
      identification.commonName ?? "no common name",
      (identification.confidence * 100).toFixed(1),
    );

    // ── Step 2: Save identification to PostgreSQL ─────────────────────────
    await prismaPg.plantIdentification.create({
      data: {
        plantId,
        speciesName: identification.speciesName,
        commonName: identification.commonName,
        confidence: identification.confidence,
        rawResponse: identification.rawResponse as object,
      },
    });

    // ── Step 3: Concurrent fetch — specs + latest telemetry ───────────────
    console.log("[Scan] Step 3: Fetching specs and telemetry concurrently...");
    const [specs, latestReading] = await Promise.all([
      // 3a. PlantSpecCache lookup (with Perenual fallback)
      (async () => {
        let cached = await prismaPg.plantSpecCache.findUnique({
          where: { speciesName: identification.speciesName },
        });

        if (!cached) {
          console.log("[Scan] Cache miss — fetching from Perenual API...");
          const perenualData = await fetchPlantSpecs(
            identification.speciesName,
          );
          if (perenualData) {
            try {
              cached = await prismaPg.plantSpecCache.create({
                data: {
                  speciesName: perenualData.speciesName,
                  commonName: perenualData.commonName,
                  idealLuxMin: perenualData.idealLuxMin,
                  idealLuxMax: perenualData.idealLuxMax,
                  idealTempMinC: perenualData.idealTempMinC,
                  idealTempMaxC: perenualData.idealTempMaxC,
                  idealHumidityMin: perenualData.idealHumidityMin,
                  idealHumidityMax: perenualData.idealHumidityMax,
                  idealPhMin: perenualData.idealPhMin,
                  idealPhMax: perenualData.idealPhMax,
                  wateringFrequency: perenualData.wateringFrequency,
                  sunlight: perenualData.sunlight,
                  rawJson: perenualData.rawJson as object,
                },
              });
              console.log(
                "[Scan] Cached specs for %s.",
                perenualData.speciesName,
              );
            } catch (error: unknown) {
              if (
                typeof error !== "object" ||
                error === null ||
                !("code" in error) ||
                (error.code !== "P2002" && error.code !== "P2034")
              ) {
                throw error;
              }

              // Another scan may have inserted this species after our cache miss.
              // Read the insertion key: Perenual may return a different name.
              cached = await prismaPg.plantSpecCache.findUnique({
                where: { speciesName: perenualData.speciesName },
              });
              if (!cached) throw error;
              console.log(
                "[Scan] Reused concurrently cached specs for %s.",
                cached.speciesName,
              );
            }
          }
        } else {
          console.log("[Scan] Cache hit for %s.", cached.speciesName);
        }

        return cached;
      })(),

      // 3b. Latest MongoDB SensorReading
      deviceId
        ? prisma.sensorReading.findFirst({
            where: { deviceId },
            orderBy: { timestamp: "desc" },
          })
        : Promise.resolve(null),
    ]);

    // ── Step 4: Calculate telemetry freshness ─────────────────────────────
    let freshnessContext: string;
    if (!latestReading) {
      freshnessContext = deviceId
        ? "No telemetry data found for this device. Sensor data is unavailable."
        : "No device associated with this plant. Environmental analysis is based on image only.";
    } else {
      const ageMs = Date.now() - latestReading.timestamp.getTime();
      const ageMinutes = Math.round(ageMs / 60_000);
      const isStale = ageMinutes > 30;

      if (ageMinutes < 1) {
        freshnessContext =
          "Sensor reading is from less than 1 minute ago (FRESH — highly reliable).";
      } else if (isStale) {
        freshnessContext = `Sensor reading is ${ageMinutes} minutes old (STALE — readings may not reflect current conditions. Treat with lower confidence).`;
      } else {
        freshnessContext = `Sensor reading is ${ageMinutes} minutes old (FRESH — reliable).`;
      }
    }
    console.log("[Scan] Freshness: %s", freshnessContext);

    // ── Step 5: Build Gemini prompt ───────────────────────────────────────
    const specsBlock = specs
      ? `
Ideal Environmental Specs for ${specs.speciesName} (${specs.commonName ?? "unknown"}):
  - Light: ${specs.idealLuxMin ?? "?"} – ${specs.idealLuxMax ?? "?"} lux
  - Temperature: ${specs.idealTempMinC ?? "?"}°C – ${specs.idealTempMaxC ?? "?"}°C
  - Humidity: ${specs.idealHumidityMin ?? "?"}% – ${specs.idealHumidityMax ?? "?"}%
  - Soil pH (reference): ${specs.idealPhMin ?? "?"} – ${specs.idealPhMax ?? "?"}
  - Watering: ${specs.wateringFrequency ?? "Unknown"}
  - Sunlight: ${specs.sunlight ?? "Unknown"}`
      : "No ideal species specs available. Provide general plant care advice.";

    const telemetryBlock = latestReading
      ? `
Actual Sensor Readings (from ESP32 hardware):
  - Temperature: ${latestReading.temperature}°C
  - Humidity: ${latestReading.humidity}%
  - Soil Moisture: ${latestReading.soilMoisture}% (raw ADC: ${latestReading.soilMoistureRaw ?? "N/A"})
  - Ambient Light: ${latestReading.lightLevel ?? "N/A"} lux

Data Freshness: ${freshnessContext}`
      : `\n${freshnessContext}`;

    const prompt = `You are an expert plant pathologist and agronomist AI for the LeafCheck smart plant care system.

Species Identified: ${identification.speciesName} (${identification.commonName ?? "unknown common name"})
Identification Confidence: ${(identification.confidence * 100).toFixed(1)}%
${specsBlock}
${telemetryBlock}

Analyze the provided plant image along with the environmental data. Compare actual sensor readings against ideal species requirements where available.

Provide a structured diagnostic report:
1. **Overall Health Status:** healthy / warning / critical
2. **Specific Diagnoses:** Each with confidence (0.0–1.0) and severity (low/moderate/high/severe). Look for pests, diseases, nutrient deficiencies, and environmental stress.
3. **Environmental Assessment:** Compare actual vs. ideal conditions for each metric.
4. **Care Recommendations:** Specific, actionable steps with urgency (routine/immediate/urgent).

Be concise, evidence-based, and actionable. If sensor data is stale or unavailable, note this limitation in your assessment.`;

    console.log("[Scan] Step 5: Sending to Gemini...");
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const contents: Parameters<typeof model.generateContent>[0] = [
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg",
        },
      },
    ];

    const result = await model.generateContent(contents);
    const analysisText = result.response.text();

    // Determine health status heuristically from response
    const lower = analysisText.toLowerCase();
    const healthStatus = lower.includes("critical")
      ? "critical"
      : lower.includes("warning") ||
          lower.includes("disease") ||
          lower.includes("pest") ||
          lower.includes("deficien")
        ? "warning"
        : "healthy";

    // ── Step 6: Save AIAnalysis to PostgreSQL ─────────────────────────────
    const analysis = await prismaPg.aIAnalysis.create({
      data: {
        plantId,
        healthStatus,
        diagnoses: [],
        recommendations: [],
        rawAnalysisText: analysisText,
        speciesName: identification.speciesName,
        telemetrySnapshot: latestReading
          ? (JSON.parse(JSON.stringify(latestReading)) as object)
          : undefined,
        idealSpecs: specs
          ? (JSON.parse(JSON.stringify(specs)) as object)
          : undefined,
      },
    });
    console.log("[Scan] Step 6: Saved AIAnalysis id=%s", analysis.id);

    // ── Step 7: Return to client ──────────────────────────────────────────
    res.status(201).json({
      success: true,
      identification: {
        speciesName: identification.speciesName,
        commonName: identification.commonName,
        confidence: identification.confidence,
      },
      diagnostic: {
        id: analysis.id,
        healthStatus,
        rawAnalysisText: analysisText,
        telemetryFreshness: freshnessContext,
      },
      telemetry: latestReading
        ? {
            temperature: latestReading.temperature,
            humidity: latestReading.humidity,
            soilMoisture: latestReading.soilMoisture,
            lightLevel: latestReading.lightLevel,
            timestamp: latestReading.timestamp.toISOString(),
          }
        : null,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Scan pipeline failed.";
    console.error("[Scan] Pipeline error:", error);
    res.status(500).json({ success: false, error: message });
  }
});
