import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { filterPlants } from "../services/garden";
import type { Plant } from "../types/plant";

const loadModule = createRequire(`${process.cwd()}/package.json`);
const web = loadModule("react-native-web");
function load(path: string, overrides: Record<string, unknown>) {
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
      require: (name: string) => {
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
type Props = {
  children?: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: { selected?: boolean };
  onPress?: () => void;
  name?: string;
  options?: { href?: string | null };
};
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  return React.Children.toArray(node).flatMap((child) =>
    React.isValidElement<Props>(child)
      ? [child, ...elements(child.props.children)]
      : [],
  );
}

test("garden search matches name, species and location without mutating either view", () => {
  const plants = [
    { id: "a", name: "Fern", species: "Nephrolepis", location: "Bedroom" },
    { id: "b", name: "Ivy", species: "Hedera", location: undefined },
  ] as Plant[];
  assert.deepEqual(
    filterPlants(plants, "  FERN ").map((p) => p.id),
    ["a"],
  );
  assert.deepEqual(
    filterPlants(plants, "hedera").map((p) => p.id),
    ["b"],
  );
  assert.deepEqual(
    filterPlants(plants, "bedroom").map((p) => p.id),
    ["a"],
  );
  assert.equal(filterPlants(plants, "").length, 2);
  assert.equal(filterPlants(plants, "missing").length, 0);
  assert.equal(plants.length, 2);
});

test("tab layout exposes only three primary tabs and retains hidden compatibility routes", () => {
  const Tabs = Object.assign(
    (props: { children?: React.ReactNode }) => props.children,
    { Screen: () => null },
  );
  const { default: Layout } = load("app/(tabs)/_layout.tsx", {
    "@/components/bottom-nav": { BottomNav: () => null },
    "expo-router": { Tabs },
  });
  const screens = elements(Layout({} as never)).filter(
    (node) => node.props.name,
  );
  assert.deepEqual(
    screens
      .filter((node) => node.props.options?.href !== null)
      .map((node) => node.props.name),
    ["index", "garden", "tasks"],
  );
  for (const node of screens)
    assert.ok(existsSync(`app/(tabs)/${node.props.name}.tsx`));
});

test("custom tab bar stays visible on content routes and hides on scan routes", () => {
  const BottomNav = () => null;
  const { default: Layout } = load("app/(tabs)/_layout.tsx", {
    "@/components/bottom-nav": { BottomNav },
    "expo-router": { Tabs: Object.assign(() => null, { Screen: () => null }) },
  });
  const layout = Layout({} as never) as React.ReactElement<{
    backBehavior: string;
    tabBar: (props: {
      state: { index: number; routes: { name: string }[] };
    }) => React.ReactElement | null;
  }>;
  assert.equal(layout.props.backBehavior, "history");
  for (const name of ["index", "garden", "tasks", "space-detail"])
    assert.equal(
      layout.props.tabBar({ state: { index: 0, routes: [{ name }] } })?.type,
      BottomNav,
    );
  for (const name of ["scanner", "camera"])
    assert.equal(
      layout.props.tabBar({ state: { index: 0, routes: [{ name }] } }),
      null,
    );
});

test("bottom navigation emits tab events, respects prevention and keeps Scan an action", () => {
  const navigated: string[] = [];
  let prevent = false;
  const events: string[] = [];
  const { BottomNav } = load("components/bottom-nav.tsx", {
    "expo-router": {
      useRouter: () => ({ navigate: (path: string) => navigated.push(path) }),
    },
    "@expo/vector-icons": { Ionicons: () => null },
    "react-native-safe-area-context": {
      useSafeAreaInsets: () => ({ bottom: 0 }),
    },
  });
  const tree = BottomNav({
    state: {
      index: 0,
      routes: ["index", "garden", "tasks"].map((name) => ({ name, key: name })),
    },
    navigation: {
      emit: (event: { type: string }) => {
        events.push(event.type);
        return { defaultPrevented: prevent };
      },
      navigate: (name: string) => navigated.push(name),
    },
  } as never);
  const buttons = elements(tree).filter(
    (node) => node.props.accessibilityLabel,
  );
  assert.equal(
    buttons.filter((node) => node.props.accessibilityRole === "tab").length,
    3,
  );
  assert.equal(
    buttons.find((node) => node.props.accessibilityLabel === "Home")?.props
      .accessibilityState?.selected,
    true,
  );
  buttons
    .find((node) => node.props.accessibilityLabel === "My Garden")
    ?.props.onPress?.();
  prevent = true;
  buttons
    .find((node) => node.props.accessibilityLabel === "Care Tasks")
    ?.props.onPress?.();
  const scan = buttons.find(
    (node) => node.props.accessibilityLabel === "Scan Plant",
  )!;
  assert.equal(scan.props.accessibilityRole, "button");
  scan.props.onPress?.();
  assert.deepEqual(navigated, ["garden", "/(tabs)/scanner"]);
  assert.deepEqual(events, ["tabPress", "tabPress"]);
});

test("legacy camera redirect preserves target params; notifications lead to actionable tasks", () => {
  const params = { plantId: "plant-1", deviceId: "sensor-1" };
  const { default: Camera } = load("app/(tabs)/camera.tsx", {
    "expo-router": { Redirect: () => null, useLocalSearchParams: () => params },
  });
  const node = Camera({} as never) as React.ReactElement<{
    href: { pathname: string; params: typeof params };
  }>;
  assert.equal(node.props.href.pathname, "/(tabs)/scanner");
  assert.equal(node.props.href.params.plantId, params.plantId);
  assert.equal(node.props.href.params.deviceId, params.deviceId);
  assert.match(
    readFileSync("app/(tabs)/notifications.tsx", "utf8"),
    /href="\/\(tabs\)\/tasks"/,
  );
  assert.doesNotMatch(
    readFileSync("components/plant-list.tsx", "utf8"),
    /SetupSummary|saved care plan/,
  );
});

test("dashboard puts plant overview directly after hardware and AI summary last", () => {
  const source = readFileSync("app/(tabs)/index.tsx", "utf8");
  assert.match(
    source,
    /<DashboardAlerts[\s\S]*?\/\>\s*\{data.loaded && <PlantOverviewCard \/>\}\s*<DashboardAiSummary/,
  );
});
