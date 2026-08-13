import { GoogleGenerativeAI } from "@google/generative-ai";
import { AIDiagnosisRequest, AIDiagnosisResponse } from "../types/ai";

const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export const analyzeFoliageHealth = async (
  request: AIDiagnosisRequest
): Promise<AIDiagnosisResponse> => {
  try {
    if (!genAI) {
      return {
        success: false,
        healthStatus: "unknown",
        diagnoses: [],
        recommendations: [],
        timestamp: new Date().toISOString(),
        error: "Gemini API key is not configured. Set EXPO_PUBLIC_GEMINI_API_KEY in your environment.",
      };
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Analyze this houseplant image for micro-pests (e.g. mealybugs, spider mites) and early signs of foliar diseases.
${request.telemetry ? `Associated Sensor Telemetry: Soil Moisture: ${request.telemetry.soilMoisture.percentage}%, pH: ${request.telemetry.phLevel.value}, PAR Light: ${request.telemetry.parLight.ppfd} PPFD.` : ""}
Provide diagnosis, health status (healthy, warning, critical), severity, and immediate care recommendations.`;

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

    return {
      success: true,
      healthStatus: "warning",
      diagnoses: [
        {
          diseaseName: "Foliar Analysis Completed",
          confidence: 0.9,
          severity: "low",
          symptoms: ["Visual inspection analyzed by Gemini AI"],
          description: responseText,
        },
      ],
      recommendations: [
        {
          action: "Review AI Report",
          urgency: "routine",
          details: responseText,
        },
      ],
      rawAnalysisText: responseText,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      success: false,
      healthStatus: "unknown",
      diagnoses: [],
      recommendations: [],
      timestamp: new Date().toISOString(),
      error: error?.message || "Failed to analyze foliage health.",
    };
  }
};
