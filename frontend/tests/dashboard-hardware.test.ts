import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import * as summaryService from "../services/dashboard-summary";
import type { Plant } from "../types/plant";
import type { DashboardSensor } from "../services/dashboard-summary";


const loadModule = createRequire(`${process.cwd()}/package.json`);
const web = loadModule("react-native-web");
const { renderToStaticMarkup } = loadModule("react-dom/server") as {
  renderToStaticMarkup(node: React.ReactNode): string;
};

function load(path: string, overrides: Record<string, unknown> = {}) {
  const exports: Record<string, (props: never) => React.ReactElement> = {};
  runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require(name: string) {
        if (name in overrides) return overrides[name];
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return loadModule(name);
        if (name === "react-native") return web;
        if (name === "./animated-pressable") return { AnimatedPressable: web.Pressable };
        if (name === "@expo/vector-icons") return { Ionicons: () => null };
        if (name === "./task-sheet") return { TaskSheet: web.View };
        if (name === "@/services/dashboard-summary") return summaryService;
        if (name.startsWith("./")) return load(`components/${name.slice(2)}.tsx`, overrides);
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  return exports;
}

type ElementProps = {
  children?: React.ReactNode;
  accessibilityLabel?: string;
  onPress?: () => void;
};
function press(node: React.ReactNode, label: string): boolean {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<ElementProps>(child)) continue;
    if (child.props.accessibilityLabel === label) {
      child.props.onPress?.();
      return true;
    }
    if (press(child.props.children, label)) return true;
  }
  return false;
}

const now = new Date(2026, 9, 12, 12);
const plant: Plant = { id: "p1", name: "Fern", species: "Fern", healthStatus: "healthy", imageUrl: "https://images.test/fern.jpg", createdAt: now.toISOString(), updatedAt: now.toISOString() };
const summary = summaryService.summarizeDashboard([plant], [], [], now);
const physical: DashboardSensor = { plant, status: "receiving", demo: false, address: "LC-A50528", name: "Window sensor", timestamp: new Date(now.getTime() - 120_000).toISOString() };
const digestProps = { summary, sensors: [physical], ready: true, careReady: true, scansReady: true, guest: false, careError: false, scansError: false, now,
  onAttention: () => {}, onTasks: () => {}, onScans: () => {}, onSensors: () => {}, onRetry: () => {} };

test("digest presents physical address, freshness and compact activity without demo or watering claims", () => {
  let opened = 0;
  const { DashboardDailyDigest } = load("components/DashboardDailyDigest.tsx");
  const node = DashboardDailyDigest({ ...digestProps, onSensors: () => opened++ } as never);
  const markup = renderToStaticMarkup(node);
  assert.match(markup, /Daily Digest/); assert.match(markup, /Receiving readings/);
  assert.match(markup, /LC-A50528/); assert.match(markup, /Updated 2 min ago/);
  assert.doesNotMatch(markup, /Demo|Mode: Auto|No sensors detected|needs water|Coming soon/);
  assert.ok(press(node, "View sensor readings")); assert.equal(opened, 1);
});
test("demo and stale labels never promise live physical data", () => {
  const { DashboardDailyDigest } = load("components/DashboardDailyDigest.tsx");
  for (const status of ["demo", "stale", "waiting", "error", "checking"] as const) {
    const markup = renderToStaticMarkup(DashboardDailyDigest({ ...digestProps, sensors: [{ ...physical, status, demo: status === "demo" }] } as never));
    assert.match(markup, new RegExp(summaryService.sensorStatusLabel(status).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(markup, /Receiving readings/);
  }
});
test("partial data failures offer retry without false all-clear or fabricated scan totals", () => {
  let retried = 0;
  const { DashboardDailyDigest } = load("components/DashboardDailyDigest.tsx");
  const node = DashboardDailyDigest({ ...digestProps, careReady: false, scansReady: false, careError: true, scansError: true, onRetry: () => retried++ } as never);
  const markup = renderToStaticMarkup(node);
  assert.match(markup, /Care tasks unavailable/); assert.match(markup, /Scan activity unavailable/);
  assert.doesNotMatch(markup, /No urgent care due|0 plants scanned/);
  assert.ok(press(node, "Care tasks unavailable · Retry")); assert.equal(retried, 1);
});
test("plant highlights use real photos, saved status and plant-specific navigation", () => {
  const { DashboardPlantCard } = load("components/DashboardPlantCard.tsx", { react: { ...React, useState: () => [undefined, () => {}] } });
  const card = DashboardPlantCard({ item: summary.highlights[0], onPress: () => {} } as never);
  const image = React.Children.toArray((card as React.ReactElement<ElementProps>).props.children)[0] as React.ReactElement<{ source: { uri: string } }>;
  assert.equal(image.props.source.uri, plant.imageUrl);
  const markup = renderToStaticMarkup(card);
  assert.match(markup, /Fern photo/); assert.match(markup, /Fern/); assert.match(markup, /Healthy · saved status/);
  const { DashboardPlantHighlights } = load("components/DashboardPlantHighlights.tsx");
  let viewed = 0;
  const node = DashboardPlantHighlights({ items: summary.highlights, onOpenPlant: () => {}, onViewAll: () => viewed++ } as never);
  assert.match(renderToStaticMarkup(node), /Your garden/);
  assert.ok(press(node, "View all plants")); assert.equal(viewed, 1);
});
test("sensor sheet keeps physical and demo identities separate and exposes exact timestamps", () => {
  const { DashboardSensorStatusSheet } = load("components/DashboardSensorStatusSheet.tsx");
  let id = "";
  const node = DashboardSensorStatusSheet({ sensors: [physical, { ...physical, plant: { ...plant, id: "demo", name: "Demo plant" }, demo: true, address: "DEMO:demo", status: "demo" }], onClose: () => {}, onOpenPlant: (value: string) => { id = value; }, onRetry: () => {} } as never);
  const markup = renderToStaticMarkup(node);
  assert.match(markup, /LC-A50528/); assert.match(markup, /Demo readings/); assert.match(markup, /Last reading/);
  assert.ok(press(node, "Open Fern growing conditions")); assert.equal(id, plant.id);
});
test("greeting is personalized and compact with no mock mode messaging", () => {
  const { GreetingHeader } = load("components/greeting-header.tsx", {
    "@/context/profile": { useProfile: () => ({ name: "Roniel Cuaresma" }) }, "./profile-button": { ProfileButton: () => null },
  });
  const markup = renderToStaticMarkup(GreetingHeader({ plantCount: 11, ready: true, now: new Date(2026, 9, 12, 8) } as never));
  assert.match(markup, /Good morning/); assert.match(markup, /Roniel/); assert.match(markup, /11 plants/);
  assert.doesNotMatch(markup, /Mock|Mode:|Hello|Private collection/);
});
test("home composes digest and highlights, drops setup banners, and navigates from the actual linked sensor", () => {
  const routes: unknown[] = [];
  const { default: Home } = load("app/(tabs)/index.tsx", {
    "@/components/DashboardDailyDigest": { DashboardDailyDigest: (props: typeof digestProps) => React.createElement(web.Pressable, { onPress: props.onSensors, accessibilityLabel: "View sensor readings" }, React.createElement(web.Text, {}, "Daily Digest")) },
    "@/components/DashboardPlantHighlights": { DashboardPlantHighlights: () => React.createElement(web.Text, {}, "Your garden") },
    "@/components/DashboardSensorStatusSheet": { DashboardSensorStatusSheet: () => null },
    "@/components/greeting-header": { GreetingHeader: () => null },
    "@/components/screen": { Screen: web.View, Action: () => null },
    "@/hooks/use-dashboard-data": { useDashboardData: () => ({ data: { plants: [plant], guest: false, loaded: true }, summary, sensors: [physical], now, ready: true, careReady: true, scansReady: true, refreshing: false, refresh: async () => {} }) },
    "expo-router": { useRouter: () => ({ push: (route: unknown) => routes.push(route) }) },
    react: { ...React, useState: (initial: unknown) => [initial, () => {}] },
  });
  const node = Home({} as never);
  const markup = renderToStaticMarkup(node);
  assert.match(markup, /Daily Digest/); assert.match(markup, /Your garden/);
  assert.doesNotMatch(markup, /Scan Plant|Pair Sensor|Coming soon|Alerts|Demo assignments/);
  // The component element callback is inspected directly; native rendering is tested above.
  function find(node: React.ReactNode): React.ReactElement<{ onSensors?: () => void; children?: React.ReactNode }> | undefined {
    for (const child of React.Children.toArray(node)) {
      if (!React.isValidElement<{ onSensors?: () => void; children?: React.ReactNode }>(child)) continue;
      if (child.props.onSensors) return child;
      const nested = find(child.props.children); if (nested) return nested;
    }
  }
  find(node)!.props.onSensors!();
  assert.deepEqual(JSON.parse(JSON.stringify(routes)), [{ pathname: "/plant-profile", params: { id: plant.id } }]);
});

test("plant photo errors fall back without hiding a replacement image", () => {
  let failedUri: string | undefined;
  const { DashboardPlantCard } = load("components/DashboardPlantCard.tsx", { react: { ...React, useState: () => [failedUri, (value: string) => { failedUri = value; }] } });
  const card = () => DashboardPlantCard({ item: summary.highlights[0], onPress: () => {} } as never) as React.ReactElement<ElementProps>;
  const image = React.Children.toArray(card().props.children)[0] as React.ReactElement<{ onError: () => void }>;
  image.props.onError();
  assert.match(renderToStaticMarkup(card()), /no plant photo/);
  const replacement = DashboardPlantCard({ item: { ...summary.highlights[0], plant: { ...plant, imageUrl: "https://images.test/new.jpg" } }, onPress: () => {} } as never) as React.ReactElement<ElementProps>;
  const nextImage = React.Children.toArray(replacement.props.children)[0] as React.ReactElement<{ source: { uri: string } }>;
  assert.equal(nextImage.props.source.uri, "https://images.test/new.jpg");
});

test("device management presents physical hardware separately from local demo assignments", () => {
  const { default: ManageDevices } = load("app/device-connection/manage.tsx", {
    "@/components/screen": { Screen: web.View, Notice: web.Text, Action: ({ label }: { label: string }) => React.createElement(web.Text, {}, label), ui: {} },
    "@/context/app-data": { useAppData: () => ({ plants: [plant], guest: false, loaded: true, error: null }) },
    "@/context/local-state": { useLocalState: () => ({ data: { connectedDevices: [{ id: "mock", name: "Demo sensor", assignedType: "plant", targetName: "Test" }] } }) },
    "@/hooks/use-dashboard-data": { useDashboardTelemetry: () => ({ sensors: [physical] }) },
    "@/hooks/use-device-activity": { useDeviceActivity: () => true },
    "@/services/dashboard-summary": summaryService,
    "expo-router": { useRouter: () => ({ push: () => {} }) },
    react: { ...React, useEffect: () => {}, useRef: () => ({ current: null }), useState: (value: unknown) => [value, () => {}] },
  });
  const markup = renderToStaticMarkup(ManageDevices({} as never));
  assert.match(markup, /Linked sensors/); assert.match(markup, /LC-A50528/); assert.match(markup, /Receiving readings/);
  assert.match(markup, /Local demo assignments/);
  assert.doesNotMatch(markup, /No physical hardware is connected|Demo assignments for this account only/);
});
