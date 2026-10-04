import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as coordinator from "../services/pre-scan-coordinator";
import type { PreScanResult } from "../types/pre-scan-validation";

const quality = { isValid: true, isBlurry: false, isDark: false, isWhite: false,
  blurScore: 200, sharpEdgeRatio: 0.1, tenengradScore: 500, meanLuminance: 100,
  stdDevLuminance: 30, overexposedRatio: 0, underexposedRatio: 0 };

function adapter(options: { missingQuality?: boolean; missingDetector?: boolean; scores?: unknown } = {}) {
  const calls: string[] = [];
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync("services/pre-scan-validation.native.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Promise, Error,
    require(name: string): unknown {
      if (name === "./pre-scan-coordinator") return coordinator;
      if (name === "react-native-image-quality") {
        if (options.missingQuality) throw new Error("missing JSI binding");
        return { ImageQuality: { analyzeImageQuality: async (path: string) => { calls.push(path); return quality; } } };
      }
      if (name === "expo-modules-core") return {
        requireOptionalNativeModule: (name: string) => {
          assert.equal(name, "PlantReproduction");
          return options.missingDetector ? null : { analyzeImage: async (uri: string) => {
            calls.push(uri); return options.scores ?? { real: 0.01, screen: 0.98, printed_photo: 0.01 };
          } };
        },
      };
      throw new Error("Unexpected import");
    },
  });
  return { validate: exports.validatePreScan as (uri: string) => Promise<PreScanResult>, calls };
}

test("native quality adapter calls raw API with decoded path and detector with original URI", async () => {
  const a = adapter();
  assert.equal((await a.validate("file:///cache/plant%20one.jpg")).reason, "screen");
  assert.deepEqual(a.calls, ["/cache/plant one.jpg", "file:///cache/plant%20one.jpg"]);
});

test("native adapter maps print scores and blocks missing detector or missing JSI module", async () => {
  assert.equal((await adapter({ scores: { real: 0.01, screen: 0.01, printed_photo: 0.98 } }).validate("file:///cache/a.jpg")).reason, "printed_photo");
  for (const options of [{ missingQuality: true }, { missingDetector: true }]) {
    const a = adapter(options);
    assert.equal((await a.validate("file:///cache/a.jpg")).reason, "validation_unavailable");
  }
});
