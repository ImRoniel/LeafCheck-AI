import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";

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

for (const count of [0, 1, 2]) {
  test(`hardware widget persists with ${count} sensors and working entry points`, () => {
    let adds = 0;
    let manages = 0;
    const { DashboardAlerts } = load("components/dashboard-alerts.tsx");
    const node = DashboardAlerts({
      message: "Sensors are optional. Demo setup only.",
      connectedCount: count,
      onConnect: () => {
        adds += 1;
      },
      onManage: () => {
        manages += 1;
      },
    } as never);
    const markup = renderToStaticMarkup(node);
    assert.match(markup, count ? /Connected Hardware/ : /Alerts/);
    assert.match(
      markup,
      count ? new RegExp(`${count} Demo Sensor`) : /No sensors detected/,
    );
    assert.match(markup, /Manage Devices/);
    assert.doesNotMatch(markup, /Dismiss|Sensors Active/);
    if (count) {
      assert.match(markup, /Mode: Auto \(With IoT\)/);
      assert.match(markup, /No live connection/);
    }
    assert.ok(press(node, count ? "Add Sensor" : "Connect Device"));
    assert.ok(press(node, "Manage Devices"));
    assert.equal(adds, 1);
    assert.equal(manages, 1);
  });
}

for (const count of [0, 2]) {
  test(`dashboard keeps both quick actions and hardware widget for ${count} sensors`, () => {
    const paths: string[] = [];
    let badge = false;
    const alerts = load("components/dashboard-alerts.tsx");
    const { default: Home } = load("app/(tabs)/index.tsx", {
      "@/components/dashboard-ai-summary": { DashboardAiSummary: () => null },
      "@/components/dashboard-alerts": alerts,
      "@/components/greeting-header": {
        GreetingHeader: ({ mockConnected }: { mockConnected: boolean }) => {
          badge = mockConnected;
          return null;
        },
      },
      "@/components/plant-overview-card": { PlantOverviewCard: () => null },
      "@/components/screen": { Screen: web.View },
      "@/context/app-data": {
        useAppData: () => ({
          loaded: true,
          loading: false,
          refresh: async () => {},
        }),
      },
      "@/context/local-state": {
        useLocalState: () => ({
          data: { connectedDevices: Array.from({ length: count }) },
        }),
      },
      "@/services/dashboard-summary": {
        getDashboardAlert: () => null,
        getDashboardCollectionStatus: () => null,
      },
      "@expo/vector-icons": { Ionicons: () => null },
      "expo-router": {
        useRouter: () => ({ push: (path: string) => paths.push(path) }),
      },
    });
    const node = Home({} as never);
    const markup = renderToStaticMarkup(node);
    assert.match(markup, /Scan Plant/);
    assert.match(markup, /Pair Sensor/);
    assert.match(markup, count ? /Connected Hardware/ : /Alerts/);
    assert.equal(badge, count > 0);
    assert.ok(press(node, "Scan Plant"));
    assert.ok(press(node, "Pair Sensor"));
    assert.deepEqual(paths, ["/(tabs)/camera", "/device-connection/scanner"]);
  });
}
