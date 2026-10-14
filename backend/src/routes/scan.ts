// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — AI Scanner Pipeline (Scan-First Architecture)
//
// POST /api/scan
//
// Orchestrates the scan-first diagnostic flow:
//   1. Optional Pl@ntNet attempt (8-second deadline; failures become Unknown)
//   2. Gemini → confirm living plant and identify/verify species from the image
//   3. Resolve owned plant context without creating a new plant yet
//   4. Parallel species-spec cache/Perenual lookup and optional MongoDB telemetry
//   5. Gemini → image + references + telemetry freshness → JSON diagnosis
//   6. Parse report Care actions through tasknotes-nlp-core; validate mapped tasks
//   7. PostgreSQL transaction → plant + identification + analysis + tasks + health
//   8. Return saved report and tasks for garden/task-screen synchronization
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { Request, Response, Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { geminiModel } from "../lib/gemini.js";
import { diagnosisFailure, logDiagnosisError } from "../lib/diagnosis-error.js";
import { diagnosisTelemetrySnapshot, readingIsFresh } from "../lib/diagnosis-telemetry.js";
import { demoDeviceId } from "../lib/demo-telemetry.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { ownedDevice, ownedPlant } from "../lib/ownership.js";
import { fetchPlantSpecs } from "../lib/perenual.js";
import { identifyPlant } from "../lib/plantnet.js";
import { prismaPg } from "../lib/prisma-pg.js";
import { prisma } from "../lib/prisma.js";
import { validateScanImage } from "../lib/scan-input.js";
import { previousScanImage } from "../lib/previous-scan-image.js";
import { validateScanEnvelope, validateScanOutput } from "../lib/scan-output.js";
import { detectScanSubject, parseGeminiJson } from "../lib/scan-subject.js";
import { reportCareTasks } from "../lib/report-care-tasks.js";
import { storeScanImage, discardScanImage, type StoredScanImage } from "../lib/scan-image-storage.js";
import { persistScan } from "../lib/scan-persistence.js";
import { latestPlantContext } from "../lib/plant-telemetry.js";
import { latestReusableIdentification } from "../lib/scan-identification.js";
import type { Prisma } from "../generated/postgres-client/index.js";
import type { GeminiStructuredOutput, PlantIdentificationResult, ScanRequest, SubjectKind } from "../types/scan.js";

export const scanRouter = Router();
scanRouter.use(requireAuth);

function sendNonlivingScan(res: Response, subjectKind: Exclude<SubjectKind, "living_plant">) {
  res.status(200).json({
    success: true, subjectKind, plant: null, identification: null,
    diagnostic: {
      id: randomUUID(), healthStatus: "unknown",
      rawAnalysisText: subjectKind === "artificial_plant"
        ? "This appears to be an artificial plant. No biological care is needed!"
        : "This doesn't appear to be a living plant. Please take a photo of a real plant to get care guidance.",
      telemetryFreshness: "Environmental monitoring is intended for living plants.",
    },
    telemetry: null, careTasks: [], notification: null,
  });
}

// ─── Validation Middleware ────────────────────────────────────────────────────

scanRouter.post(
  "/",
  asyncRoute(async (req, res, next) => {
    const data = bodyObject(req.body, [
      "imageBase64",
      "plantId",
      "deviceId",
      "location",
      "reusePreviousImage",
    ]);
    if (data.reusePreviousImage !== undefined && typeof data.reusePreviousImage !== "boolean") {
      throw new HttpError(400, "INVALID_INPUT", "reusePreviousImage must be a boolean.");
    }
    if (data.reusePreviousImage === true && data.plantId === undefined) {
      throw new HttpError(400, "INVALID_INPUT", "A plant ID is required to reuse a saved photo.");
    }
    let savedImageUrl: string | null = null;
    // plantId is now optional (scan-first)
    if (data.plantId !== undefined) {
      const plant = await ownedPlant(data.plantId, res.locals.auth.user.id);
      savedImageUrl = plant.imageUrl;
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
    if (data.location !== undefined && (typeof data.location !== "string" || data.location.trim().length > 100)) {
      throw new HttpError(400, "INVALID_INPUT", "Location must be a string of at most 100 characters.");
    }
    const image = data.reusePreviousImage === true ? await previousScanImage(savedImageUrl) : data.imageBase64;
    validateScanImage(image);
    res.locals.scanImage = image;
    next();
  }),
);

// ─── Gemini Client ────────────────────────────────────────────────────────────

// ─── POST /api/scan ───────────────────────────────────────────────────────────

scanRouter.post("/", async (req: Request, res: Response) => {
  const { plantId, deviceId, location, reusePreviousImage } = req.body as ScanRequest;
  const imageBase64: string = res.locals.scanImage;
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
    const existing = plantId ? await prismaPg.plant.findFirst({
      where: { id: plantId, userId },
      select: { id: true, name: true, species: true, deviceId: true },
    }) : null;
    if (plantId && !existing) throw new HttpError(404, "NOT_FOUND", "Plant not found.");
    if (existing && deviceId !== undefined && deviceId !== existing.deviceId) {
      throw new HttpError(404, "NOT_FOUND", "Device not associated with this plant.");
    }
    // ── Step 1: Optional Pl@ntNet attempt ────────────────────────────────
    let identification: PlantIdentificationResult;
    let identificationReused = false;
    let identificationMessage: string | undefined;
    if (reusePreviousImage && existing) {
      console.log("[Scan] Reusing saved plant identity and photo for diagnosis.");
      // A diagnosis retry reuses owned identity/photo, without identification quota.
      const previous = await latestReusableIdentification(prismaPg, existing.id, userId);
      identificationReused = previous !== null;
      if (!previous) identificationMessage = "Previous identification confidence is unavailable. Take a new photo to identify this plant again.";
      identification = { speciesName: existing.species, commonName: existing.name, confidence: previous?.confidence ?? 0,
        rawResponse: { source: "saved-plant", plantId: existing.id, identificationReused,
          ...(previous ? { previousIdentificationId: previous.id } : {}) } };
    } else {
      console.log("[Scan] Step 1: Trying Pl@ntNet (8-second deadline)...");
      try {
        identification = await identifyPlant(imageBase64);
      } catch (error: unknown) {
        console.error("[Scan] Pl@ntNet unavailable; continuing with Gemini:",
          error instanceof HttpError ? error.code : "PLANT_IDENTIFICATION_FAILED");
        identification = { speciesName: "Unknown", commonName: null, confidence: 0, rawResponse: null };
      }
      // Gemini confirms new images before Perenual or saving.
      console.log("[Scan] Step 2: Confirming the plant and species with Gemini...");
      const subject = await detectScanSubject(model, imageBase64, identification);
      if (subject.subjectKind !== "living_plant") {
        sendNonlivingScan(res, subject.subjectKind);
        return;
      }
      identification = subject.identification;
    }
    console.log(
      "[Scan] Identified: %s (%s) — confidence: %s%%",
      identification.speciesName,
      identification.commonName ?? "no common name",
      (identification.confidence * 100).toFixed(1),
    );

    // ── Step 3: Resolve plant context without persisting yet ──────────────
    let plant: {
      id: string;
      name: string;
      species: string;
      deviceId: string | null;
    };
    if (existing) {
      plant = existing;
    } else {
      // Save the confirmed identity/photo even if diagnosis subsequently fails.
      plant = {
        id: "",
        name: identification.commonName ?? identification.speciesName,
        species: identification.speciesName,
        deviceId: null,
      };
    }

    // ── Step 4: Concurrent fetch — specs + latest telemetry ───────────────
    // A new plant is paired only during persistence; its first diagnosis is
    // image-only. Existing plants use exactly the session observed here, even
    // if the sensor moves while MongoDB or Gemini is still working.
    const context = existing ? await latestPlantContext(existing.id, userId) : null;
    const sensorDevice = context?.device ?? null;
    const isDemo = sensorDevice?.macAddress.startsWith("DEMO:") ?? false;
    const sessionContext = context?.session ? Object.freeze({
      plantId: context.plant.id, pairingId: context.session.id, capturedAt: new Date().toISOString(),
    }) : null;
    console.log("[Scan] Step 4: Fetching specs and telemetry concurrently...");
    const [specs, latestReading] = await Promise.all([
      // 4a. PlantSpecCache lookup (with Perenual fallback)
      (async () => {
        if (identification.speciesName.toLowerCase() === "unknown") return null;
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
      sessionContext
        ? prisma.sensorReading.findFirst({
            where: { plantId: sessionContext.plantId, pairingId: sessionContext.pairingId, contextVersion: 1 },
            orderBy: [{ timestamp: "desc" }, { id: "desc" }],
          })
        : Promise.resolve(null),
    ]);

    // ── Step 5: Calculate telemetry freshness ─────────────────────────────
    let freshnessContext: string;
    if (!latestReading) {
      freshnessContext = sessionContext
        ? "No telemetry data found for this plant's active pairing session. Environmental analysis is based on image only."
        : sensorDevice
          ? "No active pairing session is available for this plant. Environmental analysis is based on image only."
          : "No device associated with this plant's current context. Environmental analysis is based on image only.";
    } else {
      const ageMs = Date.now() - latestReading.timestamp.getTime();
      const ageMinutes = Math.round(ageMs / 60_000);
      const isStale = !readingIsFresh(latestReading.timestamp.toISOString());

      if (isStale && ageMs < 0) {
        freshnessContext = "Sensor timestamp is in the future and cannot be verified. Do not treat these readings as current conditions.";
      } else if (!isStale && ageMinutes < 1) {
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

    const telemetry = latestReading ? {
      temperature: latestReading.temperature,
      humidity: latestReading.humidity,
      soilMoisture: isDemo ? latestReading.soilMoisture ?? null : null,
      soilMoistureRaw: isDemo ? latestReading.soilMoistureRaw ?? null
        : latestReading.soilMoistureRaw ?? latestReading.soilMoisture ?? null,
      lightLevel: isDemo ? latestReading.lightLevel ?? null : latestReading.lightLux ?? latestReading.lightLevel ?? null,
      timestamp: latestReading.timestamp.toISOString(),
    } : null;
    const telemetrySnapshot = telemetry && latestReading && sessionContext ? Object.freeze({
      deviceId: latestReading.deviceId, timestamp: telemetry.timestamp, capturedAt: sessionContext.capturedAt, simulated: isDemo,
      temperature: telemetry.temperature, humidity: telemetry.humidity,
      soilMoisture: telemetry.soilMoisture, soilMoistureRaw: telemetry.soilMoistureRaw,
      lightLux: telemetry.lightLevel,
      readingId: latestReading.id, plantId: sessionContext.plantId, pairingId: sessionContext.pairingId,
      contextVersion: 1 as const, source: "current_session" as const,
    }) : Object.freeze({ source: "none" as const });
    const telemetryBlock = telemetry
      ? `
${isDemo ? "Simulated Sensor Readings (demo data)" : "Actual Sensor Readings (from ESP32 hardware)"}:
  - Temperature: ${telemetry.temperature}°C
  - Humidity: ${telemetry.humidity}%
  - Soil Moisture Raw ADC: ${telemetry.soilMoistureRaw ?? "N/A"} (uncalibrated, 0–4095)
  - Calibrated Soil Moisture: ${telemetry.soilMoisture == null ? "Unavailable" : `${telemetry.soilMoisture}%`}
  - Ambient Light: ${telemetry.lightLevel ?? "N/A"} lux

Use this environmental data together with the image to inform your diagnosis and generate specific care actions.
Raw ADC is not a moisture percentage. Do not infer dry or wet soil from uncalibrated ADC alone; recommend checking soil before watering.

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
Reference availability and measurement availability are independent. Missing ideal species specs do not mean supplied sensor measurements are missing.
Fresh physical measurements may inform current conditions. Stale or simulated readings must be described as historical or simulated; do not present them as current measurements.

First classify the image as living_plant, artificial_plant, or non_plant. Visual evidence takes precedence over the suggested species identity.
For artificial_plant, return exactly "This appears to be an artificial plant. No biological care is needed!" as diagnosticReport, healthStatus "unknown", and notification null. Do not include Care actions or biological recommendations.
For non_plant, return "This doesn't appear to be a living plant. Please take a photo of a real plant to get care guidance." as diagnosticReport, healthStatus "unknown", and notification null. Do not include Care actions.
For living_plant, compare the environmental data with ideal requirements. Keep the assessment brief: at most three short sentences before Care actions. Avoid essays and repeated advice.

You MUST respond with a valid JSON object with exactly this structure (no markdown, no code fences, just raw JSON):
{
  "subjectKind": "living_plant" | "artificial_plant" | "non_plant",
  "healthStatus": "healthy" | "warning" | "critical" | "unknown",
  "diagnosticReport": "A personalized report as a single string with health assessment, diagnoses with confidence/severity, environmental assessment and care recommendations. Finish with exactly one Care actions section as specified below.",
  "notification": {
    "notifyAt": "ISO 8601 date-time for when the user should be notified to check on this plant next, based on your diagnosis",
    "reason": "Why the user should check on the plant at that time"
  }
}

For living_plant only, in diagnosticReport, put the heading "Care actions:" on its own line, followed by 1 to 5 dash bullets. Each bullet must contain one short English manual action beginning with a verb (Check, Inspect, Water, Move, Review, etc.). Preserve conditions: prefer "Check soil moisture; water only if dry" over unconditional watering when moisture is unknown. Include "on YYYY-MM-DD at HH:mm UTC" using a realistic absolute future date based on the Current UTC Time above. Optional urgency is written "Urgency: routine", "Urgency: immediate" or "Urgency: urgent". For example: "- Inspect the undersides of leaves on YYYY-MM-DD at HH:mm UTC. Urgency: routine" (replace placeholders with real dates).
Use no nested bullets, recurrence syntax, tags, or separate careTasks JSON field. Keep each title short and each action self-contained, with no diagnosis prose under Care actions. Never turn an instruction not to treat into an affirmative treatment.
For living_plant only, for the notification, determine the optimal time to remind the user to re-check based on the overall health status and most urgent concern.
For living_plant only, if sensor data is stale or unavailable, briefly note this limitation.
For artificial_plant and non_plant, notification must be null, overriding the example structure above.`;

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

    let output: GeminiStructuredOutput | null = null;
    let failedDiagnosis: ReturnType<typeof diagnosisFailure> | undefined;
    let diagnosisStage = "generate-content";
    try {
      const result = await model.generateContent(contents);
      diagnosisStage = "parse-report";
      const geminiOutput = parseGeminiJson(result.response.text());
      if (geminiOutput !== null && typeof geminiOutput === "object" && "subjectKind" in geminiOutput &&
        (geminiOutput.subjectKind === "artificial_plant" || geminiOutput.subjectKind === "non_plant")) {
        sendNonlivingScan(res, geminiOutput.subjectKind);
        return;
      }
      validateScanEnvelope(geminiOutput);
      diagnosisStage = "derive-care-actions";
      const candidate = { ...geminiOutput, careTasks: reportCareTasks(geminiOutput.diagnosticReport, scanTime) };
      validateScanOutput(candidate);
      output = candidate;
    } catch (error: unknown) {
      logDiagnosisError(error, diagnosisStage);
      failedDiagnosis = diagnosisFailure(error);
    }
    let storedImage: StoredScanImage | undefined;
    let photoSaveFailed = false;
    try {
      if (!reusePreviousImage) {
        storedImage = await storeScanImage(imageBase64, userId);
        photoSaveFailed = storedImage.uploadFailed ?? false;
      }
    } catch {
      // Storage errors can expose token-bearing URLs; log only a safe message.
      photoSaveFailed = true;
      storedImage = { imageUrl: `data:image/jpeg;base64,${imageBase64}`, uploadFailed: true };
      console.error("[Scan] Profile photo could not be saved.");
    }
    const saved = await persistScan(prismaPg, {
      userId, plantId, deviceId,
      name: identification.commonName ?? identification.speciesName.split(" ")[0],
      species: identification.speciesName,
      location: location?.trim() || undefined,
      scanTime, output, diagnosisFailure: failedDiagnosis, imageUrl: storedImage?.imageUrl,
      identification: {
        speciesName: identification.speciesName,
        commonName: identification.commonName,
        confidence: identification.confidence,
        rawResponse: identification.rawResponse as Prisma.InputJsonValue,
      },
      telemetrySnapshot,
      idealSpecs: specs
        ? JSON.parse(JSON.stringify(specs)) as Prisma.InputJsonValue : undefined,
    }).catch(async (error: unknown) => {
      if (storedImage) await discardScanImage(storedImage);
      throw error;
    });
    plant = saved.plant;
    const analysis = saved.analysis;
    const validTasks = saved.careTasks;

    // ── Step 10: Return to client ─────────────────────────────────────────
    res.status(201).json({
      success: true,
      subjectKind: "living_plant",
      photoSaveFailed,
      diagnosisError: Boolean(failedDiagnosis),
      ...(failedDiagnosis ? { diagnosisMessage: failedDiagnosis.message, diagnosisCode: failedDiagnosis.code } : {}),
      plant: {
        id: plant.id,
        name: plant.name,
        species: identification.speciesName,
        deviceId: plant.deviceId,
      },
      identification: {
        speciesName: identification.speciesName,
        commonName: identification.commonName,
        confidence: identification.confidence,
      },
      identificationReused,
      ...(identificationMessage ? { identificationMessage } : {}),
      diagnostic: {
        id: analysis.id,
        healthStatus: saved.healthStatus,
        rawAnalysisText: output?.diagnosticReport ?? null,
        telemetryFreshness: freshnessContext,
        createdAt: analysis.createdAt.toISOString(),
      },
      telemetry,
      telemetrySnapshot,
      careTasks: validTasks,
      notification: output ? {
        notifyAt: output.notification!.notifyAt,
        reason: output.notification!.reason,
      } : null,
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
  const plantId = typeof res.locals.guidancePlantId === "string" ? res.locals.guidancePlantId : undefined;
  const days = req.query.days === "7" ? 7 : req.query.days === "30" ? 30 : undefined;
  if (req.query.days !== undefined && days === undefined) {
    res.status(400).json({ error: "Date filter must be 7 or 30 days." });
    return;
  }
  try {
    const archives = await prismaPg.aIAnalysis.findMany({
      where: { userId, isArchived: true, ...(plantId ? { plantId } : {}),
        ...(days ? { createdAt: { gte: new Date(Date.now() - days * 86400000) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        plant: { select: { id: true, name: true, species: true } },
      },
    });
    // Null report text is the durable incomplete-diagnosis marker; no migration required.
    res.json(archives.map(entry => ({ ...entry, diagnosisError: !entry.rawAnalysisText?.trim(),
      telemetrySnapshot: diagnosisTelemetrySnapshot(entry.telemetrySnapshot, demoDeviceId(entry.plantId)),
    })));
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
