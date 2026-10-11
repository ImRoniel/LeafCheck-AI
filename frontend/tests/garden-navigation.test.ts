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
      if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: { getItem: async () => "true" } };
      if (name === "expo-secure-store") return { getItemAsync: async () => "access-fixture" };
        if (name === "react") return {
          ...React,
          useRef: (value: unknown) => ({ current: value }),
          useEffect: () => {},
        };
        if (name === "react/jsx-runtime") return loadModule(name);
        if (name === "react-native") return web;
        if (name === "@/components/animated-pressable") return { AnimatedPressable: web.Pressable };
        if (name === "@/hooks/use-reduced-motion") return { useReducedMotion: () => false };
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
    "@/context/auth": { useAuth: () => ({ isGuest: false }) },
    "expo-router": { Tabs },
  });
  const screens = elements(Layout({} as never)).filter(
    (node) => node.props.name,
  );
  assert.deepEqual(
    screens
      .filter((node) => node.props.options?.href !== null)
      .map((node) => node.props.name),
    ["index", "spaces", "tasks"],
  );
  for (const node of screens)
    assert.ok(existsSync(`app/(tabs)/${node.props.name}.tsx`));
});

test("custom tab bar stays visible on content routes and hides on scan routes", () => {
  const BottomNav = () => null;
  const { default: Layout } = load("app/(tabs)/_layout.tsx", {
    "@/components/bottom-nav": { BottomNav },
    "@/context/auth": { useAuth: () => ({ isGuest: false }) },
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
      routes: ["index", "spaces", "tasks"].map((name) => ({ name, key: name })),
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
    .find((node) => node.props.accessibilityLabel === "My Spaces")
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
  assert.deepEqual(navigated, ["spaces", "/(tabs)/scanner"]);
  assert.deepEqual(events, ["tabPress", "tabPress"]);
});

test("My Spaces stays selected on Spaces and Space Details and opens the Spaces route", () => {
  const { BottomNav } = load("components/bottom-nav.tsx", {
    "expo-router": { useRouter: () => ({ navigate: () => {} }) },
    "@expo/vector-icons": { Ionicons: () => null },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) },
  });
  for (const active of ["spaces", "space-detail"]) {
    const navigated: string[] = [];
    const routes = ["index", "spaces", "tasks", "space-detail"].map(name => ({ name, key: name }));
    const tree = BottomNav({
      state: { index: routes.findIndex(route => route.name === active), routes },
      navigation: {
        emit: () => ({ defaultPrevented: false }),
        navigate: (name: string) => navigated.push(name),
      },
    } as never);
    const tab = elements(tree).find(node => node.props.accessibilityLabel === "My Spaces")!;
    assert.equal(tab.props.accessibilityState?.selected, true);
    tab.props.onPress?.();
    assert.deepEqual(navigated, active === "spaces" ? [] : ["spaces"]);
  }
});

test("local and signed-in tab entry defaults to Dashboard", () => {
  for (const isGuest of [true, false]) {
    const { default: Layout } = load("app/(tabs)/_layout.tsx", {
      "@/components/bottom-nav": { BottomNav: () => null },
      "@/context/auth": { useAuth: () => ({ isGuest }) },
      "expo-router": { Tabs: Object.assign(() => null, { Screen: () => null }) },
    });
    const tree = Layout({} as never) as React.ReactElement<{ initialRouteName: string }>;
    assert.equal(tree.props.initialRouteName, "index");
  }
});

test("tabs switch immediately with opaque scenes and preload only the three main screens", () => {
  const Tabs = Object.assign(() => null, { Screen: () => null });
  for (const reducedMotion of [false, true]) {
    const { default: Layout } = load("app/(tabs)/_layout.tsx", {
      "@/components/bottom-nav": { BottomNav: () => null },
      "@/hooks/use-reduced-motion": { useReducedMotion: () => reducedMotion },
      "expo-router": { Tabs },
    });
    const layout = Layout({} as never) as React.ReactElement<{
      backBehavior: string;
      screenOptions: {
        animation: string;
        sceneStyle: { backgroundColor: string; overflow: string };
        transitionSpec?: unknown;
        sceneStyleInterpolator?: unknown;
      };
    }>;
    assert.equal(layout.props.backBehavior, "history");
    const options = layout.props.screenOptions;
    assert.equal(options.sceneStyle.backgroundColor, "#FFFFFF");
    assert.equal(options.sceneStyle.overflow, "hidden");
    assert.equal(options.animation, "none");
    assert.equal(options.transitionSpec, undefined);
    assert.equal(options.sceneStyleInterpolator, undefined);
    for (const screen of elements(layout).filter(node => node.props.name)) {
      const lazy = (screen.props.options as { lazy?: boolean }).lazy;
      assert.equal(lazy, ["index", "spaces", "tasks"].includes(screen.props.name!) ? false : undefined);
    }
  }
});

test("root stack preserves guards while native pushes reverse on Back and reduced motion disables them", () => {
  for (const reducedMotion of [false, true]) {
    const Stack = Object.assign(() => null, { Screen: "Screen", Protected: "Protected" });
    const { default: Layout } = load("app/_layout.tsx", {
      react: { ...React, useState: () => [true, () => {}], useRef: (current: unknown) => ({ current }), useEffect: () => {} },
      "@/context/install-onboarding": { InstallOnboardingProvider: "InstallOnboardingProvider", useInstallOnboarding: () => ({ phase: "completed" }) },
      "./splash": { __esModule: true, default: "Splash" },
      "@/hooks/use-reduced-motion": { useReducedMotion: () => reducedMotion },
      "@/components/screen": { Screen: "Screen", Notice: "Notice", Action: "Action" },
      "@/context/auth": { AuthProvider: "AuthProvider", useAuth: () => ({ status: "authenticated", isGuest: false }) },
      "@/context/local-state": { LocalStateProvider: "LocalStateProvider", useLocalState: () => ({ ready: true, data: { onboarding: { status: "complete" } } }) },
      "@/context/app-data": { AppDataProvider: "AppDataProvider" },
      "expo-router": { Stack, useRouter: () => ({}), useRootNavigationState: () => ({ key: "mounted" }) },
    });
    type RootProps = { children?: React.ReactNode; screenOptions?: { animation: string }; guard?: boolean };
    const invoke = (element: React.ReactElement<RootProps>): React.ReactElement<RootProps> => (element.type as (props: RootProps) => React.ReactElement<RootProps>)(element.props);
    let routes = Layout({} as never) as React.ReactElement<RootProps>;
    while (!routes.props.screenOptions) {
      if (typeof routes.type === "function") routes = invoke(routes);
      else {
        const child = React.Children.toArray(routes.props.children)[0];
        assert.ok(React.isValidElement<RootProps>(child));
        routes = child;
      }
    }
    assert.equal(routes.props.screenOptions.animation, reducedMotion ? "none" : "slide_from_right");
    const groups = React.Children.toArray(routes.props.children).filter(React.isValidElement) as React.ReactElement<RootProps>[];
    assert.equal(groups[1].props.guard, true); // Setup remains available explicitly.
    assert.equal(groups[2].props.guard, true);
    assert.equal(groups[3].props.guard, false); // Authentication routes remain protected.
    const modal = elements(routes).find(node => node.props.name === "modal")!;
    const options = modal.props.options as { animation: string; presentation: string };
    assert.equal(options.animation, reducedMotion ? "none" : "slide_from_bottom");
    assert.equal(options.presentation, "modal");
  }
});

test("collection entry points lead to My Spaces and Garden has no visible tab title", () => {
  for (const file of ["components/plant-overview-card.tsx", "components/delete-plant-action.tsx", "app/(tabs)/search.tsx", "app/(tabs)/explore.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /\/\(tabs\)\/spaces/);
    assert.doesNotMatch(source, /\/\(tabs\)\/garden/);
  }
  assert.doesNotMatch(readFileSync("app/(tabs)/_layout.tsx", "utf8"), /title: "My Garden"/);
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
