import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import * as guidance from "../services/plant-guidance";
import type { Plant, TelemetryPayload } from "../types";

const loadModule = createRequire(`${process.cwd()}/package.json`);
const web = loadModule("react-native-web");
const { renderToStaticMarkup } = loadModule("react-dom/server") as {
  renderToStaticMarkup(node: React.ReactNode): string;
};
const plant: Plant = {
  id: "p", name: "Fern", species: "Fern", deviceId: "d", healthStatus: "warning",
  createdAt: "2026-10-02T12:00:00Z", updatedAt: "2026-10-02T12:00:00Z",
};
type Props = { plant: Plant; telemetry: TelemetryPayload | null; telemetryError?: boolean };

function render(props: Props, hasReport = true) {
  const exports: { PlantCareSummary?: React.ComponentType<Props> } = {};
  runInNewContext(ts.transpileModule(readFileSync("components/plant-care-summary.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return loadModule(name);
      if (name === "react-native") return web;
      if (name === "expo-router") return { useRouter: () => ({ push: () => {} }) };
      if (name === "@/services/api") return { api: {} };
      if (name === "@/services/plant-guidance") return guidance;
      if (name === "@/services/use-polling-resource") return {
        usePollingResource: () => ({ loading: false, error: null, data: {
          latest: hasReport ? { id: "a", healthStatus: "warning", createdAt: plant.createdAt, rawAnalysisText: "Inspect <script>leaves</script>" } : null,
          pending: hasReport ? [{ id: "t", title: "Check soil", description: "Check before watering", urgency: "routine", dueDate: plant.createdAt }] : [],
        } }),
      };
      if (name === "./screen") return {
        ui: {},
        Notice: ({ children }: React.PropsWithChildren) => React.createElement(web.Text, null, children),
        Action: ({ label }: { label: string }) => React.createElement(web.Text, null, label),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  assert.ok(exports.PlantCareSummary);
  return renderToStaticMarkup(React.createElement(exports.PlantCareSummary, props));
}

test("plant care view renders saved guidance, missing-data warning and history without interpreting HTML", () => {
  const markup = render({ plant, telemetry: null });
  assert.match(markup, /No current sensor readings/);
  assert.match(markup, /Latest scan:.*warning/);
  assert.match(markup, /Check soil/);
  assert.match(markup, /View scan history/);
  assert.match(markup, /View care tasks/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

test("plant care view labels stale readings and does not invent a diagnosis for an unscanned plant", () => {
  const telemetry: TelemetryPayload = {
    deviceId: "d", timestamp: new Date(Date.now() - 60 * 60_000).toISOString(),
    soilMoisture: { percentage: 50, rawAnalogValue: 1000, status: "optimal" },
    lightLevel: { lux: 500, status: "optimal" },
    environment: { temperatureCelsius: 25, humidityPercentage: 60 },
  };
  const markup = render({ plant, telemetry });
  assert.match(markup, /Sensor readings are stale/);
  const empty = render({ plant: { ...plant, deviceId: undefined }, telemetry: null }, false);
  assert.match(empty, /No verified sensor link/);
  assert.match(empty, /No saved diagnosis yet/);
  assert.doesNotMatch(empty, /Latest scan:|Check soil/);
});
