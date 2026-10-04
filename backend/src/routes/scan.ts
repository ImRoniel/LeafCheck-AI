// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — AI Scanner Pipeline (Scan-First Architecture)
//
// POST /api/scan
//
// Orchestrates the scan-first diagnostic flow:
//   1. Pl@ntNet  → identify species from image
//   2. Resolve owned plant context without creating a new plant yet
//   3. Parallel species-spec cache/Perenual lookup and optional MongoDB telemetry
//   4. Gemini → image + references + telemetry freshness → JSON report
//   5. Parse report Care actions through tasknotes-nlp-core; validate mapped tasks
//   6. PostgreSQL transaction → plant + identification + analysis + tasks + health
//   7. Return saved report and tasks for garden/task-screen synchronization
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response, Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { geminiError, geminiModel } from "../lib/gemini.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { ownedDevice, ownedPlant } from "../lib/ownership.js";
import { fetchPlantSpecs } from "../lib/perenual.js";
import { identifyPlant } from "../lib/plantnet.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { prisma } from "../lib/prisma.js";
import { validateScanImage } from "../lib/scan-input.js";
import { validateScanEnvelope, validateScanOutput } from "../lib/scan-output.js";
import { reportCareTasks } from "../lib/report-care-tasks.js";
import { persistScan } from "../lib/scan-persistence.js";
import type { Prisma } from "../generated/postgres-client/index.js";
import type { ScanRequest } from "../types/scan.js";

export const scanRouter = Router();
scanRouter.use(requireAuth);

// ─── Validation Middleware ────────────────────────────────────────────────────

scanRouter.post(
  "/",
  asyncRoute(async (req, res, next) => {
    const data = bodyObject(req.body, [
      "imageBase64",
      "plantId",
      "deviceId",
      "location",
    ]);
    // plantId is now optional (scan-first)
    if (data.plantId !== undefined) {
      const plant = await ownedPlant(data.plantId, res.locals.auth.user.id);
      if (data.deviceId !== undefined && plant.deviceId !== data.deviceId) {
        throw new HttpError(
          404,
          "NOT_FOUND",
          "Device not associated with this plant.",
        );
      }
      // Check the actual device owner even when the caller uses the stored link.
      if (plant.deviceId) await ownedDevice(plant.deviceId, res.locals.auth.user.id);
    } else if (data.deviceId !== undefined) {
      await ownedDevice(data.deviceId, res.locals.auth.user.id);
    }
    validateScanImage(data.imageBase64);
    if (data.location !== undefined && (typeof data.location !== "string" || data.location.trim().length > 100)) {
      throw new HttpError(400, "INVALID_INPUT", "Location must be a string of at most 100 characters.");
    }
    next();
  }),
);

// ─── Gemini Client ────────────────────────────────────────────────────────────

// ─── POST /api/scan ───────────────────────────────────────────────────────────

scanRouter.post("/", async (req: Request, res: Response) => {
  const { imageBase64, plantId, deviceId, location } = req.body as ScanRequest;
  const userId = res.locals.auth.user.id;

  // ── Input Validation ──────────────────────────────────────────────────────
  if (!imageBase64 || typeof imageBase64 !== "string") {
    res
      .status(400)
      .json({ error: "imageBase64 is required (base64-encoded JPEG)." });
    return;
  }
  try {
    // Fail locally before spending identification quota or touching scan caches.
    const model = geminiModel();
    // ── Step 1: Identify species via Pl@ntNet ─────────────────────────────
    console.log("[Scan] Step 1: Identifying species via Pl@ntNet...");
    const identification = await identifyPlant(imageBase64);
    console.log(
      "[Scan] Identified: %s (%s) — confidence: %s%%",
      identification.speciesName,
      identification.commonName ?? "no common name",
      (identification.confidence * 100).toFixed(1),
    );

    // ── Step 2: Resolve or auto-create the Plant ──────────────────────────
    let plant: {
      id: string;
      name: string;
      species: string;
      deviceId: string | null;
    };
    if (plantId) {
      const existing = await prismaPg.plant.findFirst({
        where: { id: plantId, userId },
        select: { id: true, name: true, species: true, deviceId: true },
      });
      if (!existing) throw new HttpError(404, "NOT_FOUND", "Plant not found.");
      if (deviceId !== undefined && deviceId !== existing.deviceId) {
        throw new HttpError(404, "NOT_FOUND", "Device not associated with this plant.");
      }
      if (existing.deviceId) await ownedDevice(existing.deviceId, userId);
      plant = existing;
    } else {
      // Defer persistence until providers have produced a diagnosis.
      plant = {
        id: "",
        name: identification.commonName ?? identification.speciesName,
        species: identification.speciesName,
        deviceId: null,
      };
    }

    // ── Step 4: Concurrent fetch — specs + latest telemetry ───────────────
    const resolvedDeviceId = deviceId ?? plant.deviceId ?? undefined;
    console.log("[Scan] Step 4: Fetching specs and telemetry concurrently...");
    const [specs, latestReading] = await Promise.all([
      // 4a. PlantSpecCache lookup (with Perenual fallback)
      (async () => {
        let cached = await prismaPg.plantSpecCache.findUnique({
          where: { speciesName: identification.speciesName },
        });

        if (!cached) {
          console.log("[Scan] Cache miss — fetching from Perenual API...");
          const perenualData = await fetchPlantSpecs(
            identification.speciesName,
            identification.commonName,
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

      // 4b. Latest MongoDB SensorReading
      resolvedDeviceId
        ? prisma.sensorReading.findFirst({
            where: { deviceId: resolvedDeviceId },
            orderBy: { timestamp: "desc" },
          })
        : Promise.resolve(null),
    ]);

    // ── Step 5: Calculate telemetry freshness ─────────────────────────────
    let freshnessContext: string;
    if (!latestReading) {
      freshnessContext = resolvedDeviceId
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

    // ── Step 6: Build enhanced Gemini prompt ──────────────────────────────
    const specsBlock = specs
      ? `
Ideal Environmental Specs for ${specs.speciesName} (${specs.commonName ?? "unknown"}):
  - Light: ${specs.idealLuxMin ?? "?"} – ${specs.idealLuxMax ?? "?"} lux
  - Temperature: ${specs.idealTempMinC ?? "?"}°C – ${specs.idealTempMaxC ?? "?"}°C
  - Humidity: ${specs.idealHumidityMin ?? "?"}% – ${specs.idealHumidityMax ?? "?"}%
  - Soil pH (reference): ${specs.idealPhMin ?? "?"} – ${specs.idealPhMax ?? "?"}
  - Watering: ${specs.wateringFrequency ?? "Unknown"}
  - Sunlight: ${specs.sunlight ?? "Unknown"}`
      : "No ideal species specs available. Provide general plant care advice for the identified species and image. Explicitly disclose the missing reference data; do not invent measured conditions or verified numeric care ranges.";

    const telemetryBlock = latestReading
      ? `
Actual Sensor Readings (from ESP32 hardware):
  - Temperature: ${latestReading.temperature}°C
  - Humidity: ${latestReading.humidity}%
  - Soil Moisture: ${latestReading.soilMoisture}% (raw ADC: ${latestReading.soilMoistureRaw ?? "N/A"})
  - Ambient Light: ${latestReading.lightLevel ?? "N/A"} lux

Data Freshness: ${freshnessContext}`
      : `\n${freshnessContext}`;

    const scanTime = new Date();
    const currentTime = scanTime.toISOString();
    const prompt = `You are an expert plant pathologist and agronomist AI for the LeafCheck smart plant care system.
Current UTC Time: ${currentTime}

Species Identified: ${identification.speciesName} (${identification.commonName ?? "unknown common name"})
Identification Confidence: ${(identification.confidence * 100).toFixed(1)}%
${specsBlock}
${telemetryBlock}

Analyze the provided plant image along with the environmental data. Compare actual sensor readings against ideal species requirements where available.

You MUST respond with a valid JSON object with exactly this structure (no markdown, no code fences, just raw JSON):
{
  "healthStatus": "healthy" | "warning" | "critical",
  "diagnosticReport": "A personalized report as a single string with health assessment, diagnoses with confidence/severity, environmental assessment and care recommendations. Finish with exactly one Care actions section as specified below.",
  "notification": {
    "notifyAt": "ISO 8601 date-time for when the user should be notified to check on this plant next, based on your diagnosis",
    "reason": "Why the user should check on the plant at that time"
  }
}

In diagnosticReport, put the heading "Care actions:" on its own line, followed by 1 to 5 dash bullets. Each bullet must contain one short English manual action beginning with a verb (Check, Inspect, Water, Move, Review, etc.). Preserve conditions: prefer "Check soil moisture; water only if dry" over unconditional watering when moisture is unknown. Include "on YYYY-MM-DD at HH:mm UTC" using a realistic absolute future date based on the Current UTC Time above. Optional urgency is written "Urgency: routine", "Urgency: immediate" or "Urgency: urgent". For example: "- Inspect the undersides of leaves on YYYY-MM-DD at HH:mm UTC. Urgency: routine" (replace placeholders with real dates).
Use no nested bullets, recurrence syntax, tags, or separate careTasks JSON field. Keep each title short and each action self-contained, with no diagnosis prose under Care actions. Never turn an instruction not to treat into an affirmative treatment.
For the notification, determine the optimal time to remind the user to re-check based on the overall health status and most urgent concern.
If sensor data is stale or unavailable, note this limitation in your assessment.`;

    console.log("[Scan] Step 6: Sending to Gemini...");

    const contents: Parameters<typeof model.generateContent>[0] = [
      prompt,
      {
        inlineData: {
          data: imageBase64,
          mimeType: "image/jpeg",
        },
      },
    ];

    const result = await model
      .generateContent(contents)
      .catch((error: unknown) => {
        throw geminiError(error);
      });
    const rawText = result.response.text();

    // Parse the structured JSON from Gemini
    let geminiOutput: unknown;
    let structuredReport = true;
    try {
      // Strip markdown code fences if Gemini wraps them
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();
      geminiOutput = JSON.parse(cleaned);
    } catch {
      structuredReport = false;
      // Fallback: extract from the raw text heuristically
      console.warn(
        "[Scan] Gemini did not return valid JSON. Using heuristic fallback.",
      );
      const lower = rawText.toLowerCase();
      geminiOutput = {
        healthStatus: lower.includes("critical")
          ? "critical"
          : lower.includes("warning") ||
              lower.includes("disease") ||
              lower.includes("pest") ||
              lower.includes("deficien")
            ? "warning"
            : "healthy",
        diagnosticReport: rawText,
        notification: {
          notifyAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          reason: "Routine follow-up check recommended.",
        },
      };
    }

    validateScanEnvelope(geminiOutput);
    // Ignore any provider careTasks field: the report is the sole task source.
    const output = {
      healthStatus: geminiOutput.healthStatus,
      diagnosticReport: geminiOutput.diagnosticReport,
      notification: geminiOutput.notification,
      careTasks: reportCareTasks(structuredReport ? geminiOutput.diagnosticReport : "Unstructured report requires review.", scanTime),
    };
    validateScanOutput(output);
    const healthStatus = output.healthStatus;
    const saved = await persistScan(prismaPg, {
      userId, plantId,
      name: identification.commonName ?? identification.speciesName.split(" ")[0],
      species: identification.speciesName,
      location: location?.trim() || undefined,
      scanTime, output,
      identification: {
        speciesName: identification.speciesName,
        commonName: identification.commonName,
        confidence: identification.confidence,
        rawResponse: identification.rawResponse as Prisma.InputJsonValue,
      },
      telemetrySnapshot: latestReading
        ? JSON.parse(JSON.stringify(latestReading)) as Prisma.InputJsonValue : undefined,
      idealSpecs: specs
        ? JSON.parse(JSON.stringify(specs)) as Prisma.InputJsonValue : undefined,
    });
    plant = saved.plant;
    const analysis = saved.analysis;
    const validTasks = saved.careTasks;

    // ── Step 10: Return to client ─────────────────────────────────────────
    res.status(201).json({
      success: true,
      plant: {
        id: plant.id,
        name: plant.name,
        species: identification.speciesName,
      },
      identification: {
        speciesName: identification.speciesName,
        commonName: identification.commonName,
        confidence: identification.confidence,
      },
      diagnostic: {
        id: analysis.id,
        healthStatus,
        rawAnalysisText: output.diagnosticReport,
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
      careTasks: validTasks,
      notification: {
        notifyAt: output.notification.notifyAt,
        reason: output.notification.reason,
      },
    });
  } catch (error: unknown) {
    // Provider errors can contain credential-bearing URLs. Log codes only.
    console.error(
      "[Scan] Pipeline error:",
      error instanceof HttpError ? error.code : "SCAN_FAILED",
    );
    if (error instanceof HttpError) {
      res.status(error.status).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    } else {
      res.status(500).json({
        success: false,
        code: "SCAN_FAILED",
        error: "We couldn't complete this scan. Please try again later.",
      });
    }
  }
});

// ─── GET /api/scan/archives ───────────────────────────────────────────────────

scanRouter.get(["/archives", "/tasks"], asyncRoute(async (req, res, next) => {
  if (req.query.plantId !== undefined) {
    const plant = await ownedPlant(req.query.plantId, res.locals.auth.user.id);
    res.locals.guidancePlantId = plant.id;
  }
  next();
}));

scanRouter.get("/archives", async (req: Request, res: Response) => {
  const userId = res.locals.auth.user.id;
  try {
    const archives = await prismaPg.aIAnalysis.findMany({
      where: { userId, isArchived: true, ...(res.locals.guidancePlantId ? { plantId: res.locals.guidancePlantId as string } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        plant: { select: { id: true, name: true, species: true } },
      },
    });
    res.json(archives);
  } catch (error) {
    console.error("[Scan] Archives error:", error);
    res.status(500).json({ error: "Failed to fetch archives." });
  }
});

// ─── GET /api/scan/tasks ──────────────────────────────────────────────────────

scanRouter.get("/tasks", async (req: Request, res: Response) => {
  const userId = res.locals.auth.user.id;
  try {
    const tasks = await prismaPg.careTask.findMany({
      where: { userId, ...(res.locals.guidancePlantId ? { plantId: res.locals.guidancePlantId as string } : {}) },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 50,
      include: {
        plant: { select: { id: true, name: true, species: true } },
      },
    });
    res.json(tasks);
  } catch (error) {
    console.error("[Scan] Tasks error:", error);
    res.status(500).json({ error: "Failed to fetch tasks." });
  }
});

// ─── PATCH /api/scan/tasks/:id ────────────────────────────────────────────────

scanRouter.patch(
  "/tasks/:id",
  asyncRoute(async (req: Request, res: Response) => {
    const userId = res.locals.auth.user.id;
    const taskId = req.params.id as string;
    const { status } = bodyObject(req.body, ["status"]);

    if (
      typeof status !== "string" ||
      !["PENDING", "COMPLETED", "SKIPPED"].includes(status)
    ) {
      throw new HttpError(400, "INVALID_INPUT", "Invalid task status.");
    }

    try {
      const task = await prismaPg.careTask.update({
        where: { id: taskId, userId },
        data: {
          status,
          completedAt: status === "COMPLETED" ? new Date() : undefined,
        },
      });
      res.json(task);
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025")
        throw new HttpError(404, "NOT_FOUND", "Task not found.");
      throw error;
    }
  }),
);
