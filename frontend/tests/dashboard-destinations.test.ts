import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { plantsNeedingAttention } from "../services/plant-attention";
import { summarizeDashboard } from "../services/dashboard-summary";
import * as summaryService from "../services/dashboard-summary";
import { overviewReadingStatus } from "../services/sensor-overview";
import type { Plant } from "../types/plant";
import type { SensorOverviewEntry } from "../types/device";
const requireModule = createRequire(`${process.cwd()}/package.json`);
const web = requireModule("react-native-web");
const { renderToStaticMarkup } = requireModule("react-dom/server") as { renderToStaticMarkup: (node: React.ReactNode) => string };
type Props = { children?: React.ReactNode; accessibilityLabel?: string; onPress?: () => void; onSensors?: () => void; onOpenPlant?: (id: string) => void; onClear?: () => void; label?: string };
const elements = (node: React.ReactNode): React.ReactElement<Props>[] => React.Children.toArray(node).flatMap(child => React.isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);
const press = (node: React.ReactNode, label: string) => { const control = elements(node).find(child => child.props.accessibilityLabel === label || child.props.label === label); assert.ok(control, label); control.props.onPress!(); };
function load(file: string, overrides: Record<string, unknown> = {}) {
  const exports: Record<string, (props: never) => React.ReactElement<Props>> = {};
  runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require(name: string) {
      if (name in overrides) return overrides[name];
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return requireModule(name);
      if (name === "react-native") return web;
      if (name === "./animated-pressable") return { AnimatedPressable: web.Pressable };
      if (name === "@expo/vector-icons") return { Ionicons: () => null };
      if (name === "./task-sheet") return { TaskSheet: ({ title, children }: { title: string; children: React.ReactNode }) => React.createElement(web.View, {}, React.createElement(web.Text, {}, title), children) };
      if (name === "./screen") return { Screen: web.View, Action: ({ label, onPress }: { label: string; onPress: () => void }) => React.createElement(web.Pressable, { onPress, accessibilityLabel: label }, React.createElement(web.Text, {}, label)) };
      if (name === "./care-task-thumbnail") return { CareTaskThumbnail: () => null };
      if (name === "@/services/plant-attention") return { plantsNeedingAttention };
      if (name === "@/services/dashboard-summary") return summaryService;
      if (name === "@/services/sensor-overview") return { overviewReadingStatus };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return exports;
}
const now = new Date();
const plant: Plant = { id: "11111111-1111-4111-8111-111111111111", name: "Fern", species: "Fern", healthStatus: "warning", createdAt: now.toISOString(), updatedAt: now.toISOString() };
const entry: SensorOverviewEntry = { device: { id: "22222222-2222-4222-8222-222222222222", userId: plant.id, name: "Window sensor", macAddress: "LC-A50528", status: "OFFLINE", createdAt: now.toISOString(), updatedAt: now.toISOString() }, plants: [{ id: plant.id, name: plant.name }], demo: false, readingError: false,
  telemetry: { deviceId: "22222222-2222-4222-8222-222222222222", timestamp: now.toISOString(), environment: { temperatureCelsius: 0, humidityPercentage: 0 }, soilMoisture: { percentage: null, rawAnalogValue: 0, status: "unavailable" }, lightLevel: { lux: 0, status: "insufficient" } } };

test("attention list and digest count agree: only Warning/Critical plants, critical first", () => {
  const plants = [plant, { ...plant, id: "healthy", name: "Healthy", healthStatus: "healthy" as const }, { ...plant, id: "unknown", name: "Unknown", healthStatus: "unknown" as const }, { ...plant, id: "critical", name: "Critical fern", healthStatus: "critical" as const }];
  const due = { id: "task", key: "task", plantId: "healthy", title: "Water", details: "", dueAt: new Date(now.getTime() - 1000).toISOString(), priority: "routine" as const };
  assert.deepEqual(plantsNeedingAttention(plants).map(plant => plant.id), ["critical", plant.id]);
  assert.equal(summarizeDashboard(plants, [due], [], now).attention.length, 2);
  const { NeedsAttentionPlantList } = load("components/NeedsAttentionPlantList.tsx");
  let opened: Plant | undefined;
  const node = NeedsAttentionPlantList({ plants, ready: true, loading: false, error: null, onRefresh: () => {}, onClear: () => {}, onOpen: (plant: Plant) => { opened = plant; } } as never);
  const markup = renderToStaticMarkup(node);
  assert.match(markup, /Critical fern/); assert.match(markup, /Fern/); assert.doesNotMatch(markup, />Healthy<|>Unknown</);
  press(node, "Open Fern, warning health status"); assert.equal(opened?.id, plant.id);
});
test("attention view errors/loading never imply a healthy collection", () => {
  const { NeedsAttentionPlantList } = load("components/NeedsAttentionPlantList.tsx");
  const markup = renderToStaticMarkup(NeedsAttentionPlantList({ plants: [], ready: false, loading: false, error: "offline", onRefresh: () => {}, onClear: () => {}, onOpen: () => {} } as never));
  assert.match(markup, /Couldn’t refresh/); assert.doesNotMatch(markup, /No plants with Warning/);
});
test("Spaces filter opens a plant list and clears back to the canonical space cards", () => {
  let filter = "needs-attention"; const routes: unknown[] = [];
  const { default: Spaces } = load("app/(tabs)/spaces.tsx", {
    "@/components/NeedsAttentionPlantList": { NeedsAttentionPlantList: "AttentionList" }, "@/components/space-management": { SpaceManagement: "SpaceManagement" },
    "@/components/space-menu-button": { SpaceMenuButton: "Menu" }, "@/components/profile-button": { ProfileButton: "Profile" }, "@/components/animated-pressable": { AnimatedPressable: web.Pressable },
    "@/context/app-data": { useAppData: () => ({ plants: [plant], loaded: true, loading: false, error: null, guest: false }) },
    "@/context/local-state": { useLocalState: () => ({ data: { onboarding: { status: "completed" } } }) },
    "@/context/spaces": { useSpaces: () => ({ spaces: ["Unassigned"], plantsBySpace: { Unassigned: [plant] }, ready: true, archivedSpaces: [] }) },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "expo-router": { useLocalSearchParams: () => ({ filter }), useRouter: () => ({ setParams: (params: { filter: string }) => { filter = params.filter; }, push: (route: unknown) => routes.push(route) }) },
    react: { ...React, useState: (value: unknown) => [value, () => {}], useRef: (value: unknown) => ({ current: value }) },
  });
  const node = Spaces({} as never); assert.equal(node.type, "AttentionList");
  (node.props as Props & { onOpen: (plant: Plant) => void }).onOpen(plant);
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/plant-profile", params: { id: plant.id } }]);
  node.props.onClear!(); assert.equal(filter, ""); assert.notEqual(Spaces({} as never).type, "AttentionList");
});
test("sensor modal lists identities, linked/unlinked devices and zero-valued metrics", () => {
  const overview = { ready: true, loading: false, error: null, entries: [entry, { ...entry, device: { ...entry.device, id: "other", macAddress: "LC-000001" }, plants: [], telemetry: null }], refresh: async () => {} };
  const { DashboardSensorStatusSheet } = load("components/DashboardSensorStatusSheet.tsx", { "@/hooks/use-sensor-overview": { useSensorOverview: () => overview } });
  const markup = renderToStaticMarkup(DashboardSensorStatusSheet({ onClose: () => {}, onOpenPlant: () => {} } as never));
  for (const text of [/Sensor Overview/, /LC-A50528/, /LC-000001/, /Linked plant · Fern/, /Not linked to a plant/, /Last received/, /0 °C/, /0%/, /0 ADC/, /requires calibration/]) assert.match(markup, text);
  overview.entries[0] = { ...entry, readingError: true, telemetry: null };
  const failed = renderToStaticMarkup(DashboardSensorStatusSheet({ onClose: () => {}, onOpenPlant: () => {} } as never));
  assert.match(failed, /LC-A50528/); assert.match(failed, /Couldn’t refresh readings/); assert.match(failed, /Last reading unavailable/);
});
test("overview distinguishes stale, demo and failed cached readings", () => {
  assert.equal(overviewReadingStatus(entry, now), "receiving");
  assert.equal(overviewReadingStatus({ ...entry, telemetry: { ...entry.telemetry!, timestamp: new Date(now.getTime() - 31 * 60_000).toISOString() } }, now), "stale");
  assert.equal(overviewReadingStatus({ ...entry, demo: true }, now), "demo");
  assert.equal(overviewReadingStatus(entry, now, true), "error");
});
test("sensor link opens the overview for zero, one or many sensors, including failed readings", () => {
  const { DashboardDailyDigest } = load("components/DashboardDailyDigest.tsx");
  let open = false; const pushed: unknown[] = [];
  const dashboard = { data: { plants: [plant], loaded: true, guest: false }, summary: summarizeDashboard([plant], [], [], now), sensors: [] as summaryService.DashboardSensor[], now, ready: true, careReady: true, scansReady: true, refreshing: false, refresh: async () => {} };
  const { default: Home } = load("app/(tabs)/index.tsx", {
    "@/components/DashboardDailyDigest": { DashboardDailyDigest }, "@/components/DashboardPlantHighlights": { DashboardPlantHighlights: "Highlights" }, "@/components/DashboardSensorStatusSheet": { DashboardSensorStatusSheet: "Overview" },
    "@/components/greeting-header": { GreetingHeader: "Header" }, "@/components/screen": { Screen: "Screen", Action: "Action" },
    "@/hooks/use-dashboard-data": { useDashboardData: () => dashboard },
    "expo-router": { useRouter: () => ({ push: (route: unknown) => pushed.push(route), navigate: () => {} }) },
    react: { ...React, useState: () => [open, (value: boolean) => { open = value; }] },
  });
  for (const count of [0, 1, 2]) {
    open = false;
    dashboard.sensors = Array.from({ length: count }, () => ({ plant, status: "error", demo: false, address: null, name: "Linked sensor", timestamp: null }));
    const digest = elements(Home({} as never)).find(node => node.props.onSensors)!;
    press(DashboardDailyDigest(digest.props as never), "View sensor status");
    assert.ok(elements(Home({} as never)).some(node => node.type === "Overview"));
    assert.equal(pushed.length, 0);
  }
});
