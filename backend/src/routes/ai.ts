import { Request, Response, Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { geminiError, geminiModel } from "../lib/gemini.js";
import { asyncRoute, bodyObject, HttpError } from "../lib/http.js";
import { ownedPlant } from "../lib/ownership.js";
import { AIDiagnosisRequest, AIDiagnosisResponse } from "../types/ai.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);
aiRouter.post(
  "/analyze",
  asyncRoute(async (req, res, next) => {
    const data = bodyObject(req.body, [
      "imageBase64",
      "telemetry",
      "plantId",
      "notes",
    ]);
    if (data.plantId !== undefined)
      await ownedPlant(data.plantId, res.locals.auth.user.id);
    if (
      (data.imageBase64 !== undefined &&
        typeof data.imageBase64 !== "string") ||
      (data.notes !== undefined &&
        (typeof data.notes !== "string" || data.notes.length > 2000))
    ) {
      throw new HttpError(400, "INVALID_INPUT", "Invalid analysis input.");
    }
    if (data.telemetry !== undefined) {
      const t = bodyObject(data.telemetry, [
        "deviceId",
        "timestamp",
        "soilMoisture",
        "lightLevel",
        "environment",
      ]);
      const soil = bodyObject(t.soilMoisture, [
        "percentage",
        "rawAnalogValue",
        "status",
      ]);
      if (
        typeof soil.percentage !== "number" ||
        !Number.isFinite(soil.percentage) ||
        !["dry", "optimal", "overwatered"].includes(String(soil.status))
      )
        throw new HttpError(400, "INVALID_INPUT", "Invalid telemetry.");
      if (t.lightLevel !== undefined) {
        const light = bodyObject(t.lightLevel, ["lux", "status"]);
        if (
          typeof light.lux !== "number" ||
          !Number.isFinite(light.lux) ||
          !["insufficient", "optimal", "excessive"].includes(
            String(light.status),
          )
        )
          throw new HttpError(400, "INVALID_INPUT", "Invalid telemetry.");
      }
      if (t.environment !== undefined) {
        const environment = bodyObject(t.environment, [
          "temperatureCelsius",
          "humidityPercentage",
        ]);
        if (
          Object.values(environment).length !== 2 ||
          Object.values(environment).some(
            (v) => typeof v !== "number" || !Number.isFinite(v),
          )
        )
          throw new HttpError(400, "INVALID_INPUT", "Invalid telemetry.");
      }
    }
    next();
  }),
);

// Gemini client — initialized server-side, key never leaves the backend

/**
 * POST /api/ai/analyze
 * Receives a foliage analysis request from the mobile app.
 * Calls Gemini API server-side and returns the diagnosis.
 *
 * Body: AIDiagnosisRequest { imageBase64?, telemetry?, plantId?, notes? }
 */
aiRouter.post("/analyze", async (req: Request, res: Response) => {
  const request = req.body as AIDiagnosisRequest;

  try {
    const model = geminiModel(false);

    const telemetrySummary = request.telemetry
      ? `Associated Sensor Telemetry:
  - Soil Moisture: ${request.telemetry.soilMoisture.percentage.toFixed(1)}% (${request.telemetry.soilMoisture.status})
  ${request.telemetry.lightLevel ? `- Light Level: ${request.telemetry.lightLevel.lux.toFixed(1)} lux (${request.telemetry.lightLevel.status})` : ""}
  ${request.telemetry.environment ? `- Temperature: ${request.telemetry.environment.temperatureCelsius}°C, Humidity: ${request.telemetry.environment.humidityPercentage}%` : ""}`
      : "";

    const prompt = `You are an expert plant pathologist and agronomist AI.
Analyze this houseplant image for:
1. Micro-pests (e.g. mealybugs, spider mites, aphids, scale insects)
2. Early signs of foliar diseases (e.g. fungal spots, rust, powdery mildew, root rot symptoms)
3. Nutrient deficiencies visible in the leaves

${telemetrySummary}
${request.notes ? `Grower Notes: ${request.notes}` : ""}

Respond with:
- Overall health status: healthy / warning / critical
- Specific diagnoses with confidence (0.0 to 1.0) and severity (low/moderate/high/severe)
- Immediate care recommendations with urgency (routine/immediate/urgent)
- Be concise and actionable.`;

    const contents: Parameters<typeof model.generateContent>[0] = [prompt];

    if (request.imageBase64) {
      contents.push({
        inlineData: {
          data: request.imageBase64,
          mimeType: "image/jpeg",
        },
      });
    }

    const result = await model
      .generateContent(contents)
      .catch((error: unknown) => {
        throw geminiError(error);
      });
    const responseText = result.response.text();

    // Determine health status from response text heuristically
    const lowerText = responseText.toLowerCase();
    const healthStatus: AIDiagnosisResponse["healthStatus"] =
      lowerText.includes("critical")
        ? "critical"
        : lowerText.includes("warning") ||
            lowerText.includes("concern") ||
            lowerText.includes("disease")
          ? "warning"
          : "healthy";

    const response: AIDiagnosisResponse = {
      success: true,
      healthStatus,
      diagnoses: [
        {
          diseaseName: "Gemini AI Foliar Analysis",
          confidence: 0.9,
          severity:
            healthStatus === "critical"
              ? "high"
              : healthStatus === "warning"
                ? "moderate"
                : "low",
          symptoms: ["Visual inspection completed by Gemini AI"],
          description: responseText,
        },
      ],
      recommendations: [
        {
          action: "Review AI Diagnosis Report",
          urgency:
            healthStatus === "critical"
              ? "urgent"
              : healthStatus === "warning"
                ? "immediate"
                : "routine",
          details: responseText,
        },
      ],
      rawAnalysisText: responseText,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  } catch (error: unknown) {
    const failure = error instanceof HttpError ? error : geminiError(error);
    console.error("[AI] /analyze error:", failure.code);
    const errorResponse: AIDiagnosisResponse = {
      success: false,
      healthStatus: "unknown",
      diagnoses: [],
      recommendations: [],
      timestamp: new Date().toISOString(),
      error: failure.message,
    };
    res.status(failure.status).json({ ...errorResponse, code: failure.code });
  }
});
