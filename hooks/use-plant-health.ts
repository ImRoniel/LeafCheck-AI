import { useState } from "react";
import { AIDiagnosisRequest, AIDiagnosisResponse } from "../types";
import { analyzeFoliageHealth } from "../services";

export const usePlantHealth = () => {
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [diagnosisResult, setDiagnosisResult] = useState<AIDiagnosisResponse | null>(null);

  const diagnosePlant = async (request: AIDiagnosisRequest) => {
    setAnalyzing(true);
    try {
      const result = await analyzeFoliageHealth(request);
      setDiagnosisResult(result);
      return result;
    } catch (error: any) {
      const errResponse: AIDiagnosisResponse = {
        success: false,
        healthStatus: "unknown",
        diagnoses: [],
        recommendations: [],
        timestamp: new Date().toISOString(),
        error: error?.message || "Diagnosis execution failed",
      };
      setDiagnosisResult(errResponse);
      return errResponse;
    } finally {
      setAnalyzing(false);
    }
  };

  return { analyzePlant: diagnosePlant, analyzing, diagnosisResult };
};
