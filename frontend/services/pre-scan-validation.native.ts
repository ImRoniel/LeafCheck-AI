import { requireOptionalNativeModule } from "expo-modules-core";
import { createPreScanValidator, localImagePath } from "./pre-scan-coordinator";
import type { ReproductionScores } from "../types/pre-scan-validation";

interface PlantReproductionModule {
  analyzeImage(uri: string): Promise<ReproductionScores>;
}

// Lazy import catches missing Nitro/JSI bindings in Expo Go and stale development clients.
// Expo resolves this file only on native; web never evaluates either native dependency.
let qualityModule: Promise<typeof import("react-native-image-quality")> | undefined;
export const validatePreScan = createPreScanValidator({
  async analyzeQuality(uri) {
    qualityModule ??= import("react-native-image-quality").catch(error => {
      qualityModule = undefined;
      throw error;
    });
    const { ImageQuality } = await qualityModule;
    const path = localImagePath(uri);
    if (!path) throw new Error("Invalid local image");
    return ImageQuality.analyzeImageQuality(path);
  },
  async detectReproduction(uri) {
    // TS integration contract only: the model-backed native module is supplied separately.
    // Absence is an unavailable result, never an implicit real-plant prediction.
    const detector = requireOptionalNativeModule<PlantReproductionModule>("PlantReproduction");
    if (!detector || typeof detector.analyzeImage !== "function") throw new Error("Detector unavailable");
    return detector.analyzeImage(uri);
  },
});
