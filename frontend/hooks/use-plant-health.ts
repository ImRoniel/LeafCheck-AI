import { useState } from "react";
import { AIDiagnosisRequest, AIDiagnosisResponse } from "../types/ai";
import { analyzePlant } from "../services";

/**
 * usePlantHealth — triggers AI diagnosis via the backend proxy.
 * The Gemini API key is never exposed to the mobile client.
 */
export const usePlantHealth = () => {
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [diagnosisResult, setDiagnosisResult] =
    useState<AIDiagnosisResponse | null>(null);

  const diagnosePlant = async (
    request: AIDiagnosisRequest
  ): Promise<AIDiagnosisResponse> => {
    setAnalyzing(true);
    try {
      const result = await analyzePlant(request);
      setDiagnosisResult(result);
      return result;
    } catch (error: any) {
      const errResponse: AIDiagnosisResponse = {
        success: false,
        healthStatus: "unknown",
        diagnoses: [],
        recommendations: [],
        timestamp: new Date().toISOString(),
        error: error?.message ?? "Diagnosis execution failed",
      };
      setDiagnosisResult(errResponse);
      return errResponse;
    } finally {
      setAnalyzing(false);
    }
  };

  return { analyzePlant: diagnosePlant, analyzing, diagnosisResult };
};
