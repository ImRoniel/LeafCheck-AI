import { Router, Request, Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AIDiagnosisRequest, AIDiagnosisResponse } from "../types/ai.js";

export const aiRouter = Router();

// Gemini client — initialized server-side, key never leaves the backend
const apiKey = process.env.GEMINI_API_KEY ?? "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

/**
 * POST /api/ai/analyze
 * Receives a foliage analysis request from the mobile app.
 * Calls Gemini API server-side and returns the diagnosis.
 *
 * Body: AIDiagnosisRequest { imageBase64?, telemetry?, plantId?, notes? }
 */
aiRouter.post("/analyze", async (req: Request, res: Response) => {
  const request = req.body as AIDiagnosisRequest;

  if (!genAI) {
    const errorResponse: AIDiagnosisResponse = {
      success: false,
      healthStatus: "unknown",
      diagnoses: [],
      recommendations: [],
      timestamp: new Date().toISOString(),
      error:
        "Gemini API key is not configured. Set GEMINI_API_KEY in /backend/.env",
    };
    res.status(503).json(errorResponse);
    return;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

    const contents: any[] = [prompt];

    if (request.imageBase64) {
      contents.push({
        inlineData: {
          data: request.imageBase64,
          mimeType: "image/jpeg",
        },
      });
    }

    const result = await model.generateContent(contents);
    const responseText = result.response.text();

    // Determine health status from response text heuristically
    const lowerText = responseText.toLowerCase();
    const healthStatus: AIDiagnosisResponse["healthStatus"] = lowerText.includes("critical")
      ? "critical"
      : lowerText.includes("warning") || lowerText.includes("concern") || lowerText.includes("disease")
      ? "warning"
      : "healthy";

    const response: AIDiagnosisResponse = {
      success: true,
      healthStatus,
      diagnoses: [
        {
          diseaseName: "Gemini AI Foliar Analysis",
          confidence: 0.9,
          severity: healthStatus === "critical" ? "high" : healthStatus === "warning" ? "moderate" : "low",
          symptoms: ["Visual inspection completed by Gemini AI"],
          description: responseText,
        },
      ],
      recommendations: [
        {
          action: "Review AI Diagnosis Report",
          urgency: healthStatus === "critical" ? "urgent" : healthStatus === "warning" ? "immediate" : "routine",
          details: responseText,
        },
      ],
      rawAnalysisText: responseText,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  } catch (error: any) {
    console.error("[AI] /analyze error:", error);
    const errorResponse: AIDiagnosisResponse = {
      success: false,
      healthStatus: "unknown",
      diagnoses: [],
      recommendations: [],
      timestamp: new Date().toISOString(),
      error: error?.message ?? "Gemini AI analysis failed.",
    };
    res.status(500).json(errorResponse);
  }
});
