import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";

const loadModule = createRequire(`${process.cwd()}/package.json`);
const web = loadModule("react-native-web");
type Props = {
  children?: React.ReactNode;
  style?: unknown;
  pointerEvents?: string;
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityHint?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  name?: string;
  size?: number;
  color?: string;
  numberOfLines?: number;
  accessibilityState?: { selected?: boolean };
};
type Element = React.ReactElement<Props>;
function children(node: Element): Element[] {
  return React.Children.toArray(node.props.children).filter(
    React.isValidElement<Props>,
  );
}
function tabIcon(tab: Element): Element {
  return children(children(tab)[0])[0];
}
function loadNav(active = "index", insets = { bottom: 24, left: 44, right: 0 }) {
  const navigated: string[] = [];
  const events: { type: string; target: string }[] = [];
  const exports: { BottomNav?: (props: unknown) => Element } = {};
  runInNewContext(
    ts.transpileModule(readFileSync("components/bottom-nav.tsx", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require(name: string) {
        if (name === "react/jsx-runtime") return loadModule(name);
        if (name === "react") return {
          useRef: (value: unknown) => ({ current: value }),
          useEffect: () => {},
        };
        if (name === "react-native") return web;
        if (name === "@/components/animated-pressable") return { AnimatedPressable: web.Pressable };
        if (name === "@/hooks/use-reduced-motion") return { useReducedMotion: () => false };
        if (name === "@expo/vector-icons") return { Ionicons: () => null };
        if (name === "expo-router")
          return {
            useRouter: () => ({
              navigate: (path: string) => navigated.push(path),
            }),
          };
        if (name === "react-native-safe-area-context")
          return {
            useSafeAreaInsets: () => insets,
          };
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  const tree = exports.BottomNav!({
    state: {
      index: ["index", "spaces", "tasks", "scanner", "space-detail"].indexOf(active),
      routes: ["index", "spaces", "tasks", "scanner", "space-detail"].map((name) => ({
        name,
        key: name,
      })),
    },
    navigation: {
      emit(event: { type: string; target: string }) {
        events.push(event);
        return { defaultPrevented: false };
      },
      navigate: (name: string) => navigated.push(name),
    },
  });
  return { tree, navigated, events };
}

test("reference-sized floating pill and camera share a centerline and retain readable labels", () => {
  const { tree, events } = loadNav();
  const outer = web.StyleSheet.flatten(tree.props.style);
  assert.equal(outer.bottom, 36);
  assert.equal(outer.left, 44);
  assert.equal(outer.right, 44);
  assert.equal(tree.props.pointerEvents, "box-none");
  const [dock] = children(tree);
  assert.equal(dock.props.pointerEvents, "box-none");
  const dockStyle = web.StyleSheet.flatten(dock.props.style);
  assert.equal(dockStyle.flexDirection, "row");
  assert.equal(dockStyle.alignItems, "center");
  assert.equal(dockStyle.width, 303);
  assert.equal(dockStyle.maxWidth, "100%");
  assert.equal(dockStyle.gap, 10);
  const [bar, scan] = children(dock);
  assert.equal(children(dock).length, 2);
  assert.equal(children(bar).length, 3);
  assert.equal(scan.props.accessibilityLabel, "Scan Plant");
  assert.equal(scan.props.accessibilityRole, "button");
  assert.match(scan.props.accessibilityHint!, /camera/);
  const barStyle = web.StyleSheet.flatten(bar.props.style);
  assert.equal(barStyle.flex, 1);
  assert.equal(barStyle.backgroundColor, "#FFFFFF");
  const scanStyles = scan.props.style as (state: {
    pressed: boolean;
  }) => unknown;
  const scanStyle = web.StyleSheet.flatten(scanStyles({ pressed: false }));
  assert.equal(scanStyle.backgroundColor, "#278448");
  assert.equal(web.StyleSheet.flatten(scanStyles({ pressed: true })).backgroundColor, "#1B6B36");
  assert.equal((children(scan)[0].props as { color?: string }).color, "#FFFFFF");
  assert.equal(scanStyle.width, 58);
  assert.equal(scanStyle.height, scanStyle.width);
  assert.equal(scanStyle.borderRadius, scanStyle.width / 2);
  assert.equal(scanStyle.flexShrink, 0);
  assert.equal(barStyle.minHeight, scanStyle.height);
  assert.equal(barStyle.borderRadius, scanStyle.borderRadius);
  assert.equal(barStyle.borderWidth, undefined);
  assert.equal(dockStyle.width - scanStyle.width - dockStyle.gap, 235);
  assert.equal(scanStyle.marginBottom, undefined);
  assert.equal(scanStyle.marginTop, undefined);
  for (const style of [barStyle, scanStyle]) {
    assert.equal(style.elevation, 5);
    assert.equal(style.shadowColor, "#193E27");
    assert.equal(style.shadowOpacity, 0.15);
    assert.equal(style.shadowRadius, 6);
    assert.equal(style.boxShadow, undefined);
    assert.equal(style.transform, undefined);
  }
  assert.notEqual(
    web.StyleSheet.flatten(scanStyles({ pressed: true })).backgroundColor,
    scanStyle.backgroundColor,
  );
  const tabs = children(bar);
  assert.deepEqual(
    tabs.map((tab) => tab.props.accessibilityLabel),
    ["Home", "My Spaces", "Care Tasks"],
  );
  for (const tab of tabs) {
    assert.equal(tab.props.accessibilityRole, "tab");
    const style = web.StyleSheet.flatten(tab.props.style);
    assert.equal(style.flex, 1);
    assert.equal(style.minWidth, 0); // Allow the pill to shrink safely on narrow screens.
    assert.ok(style.minHeight >= 48);
    assert.equal(
      style.minHeight + 2 * barStyle.paddingVertical,
      scanStyle.height,
    );
    const label = children(tab)[1];
    assert.equal(label.props.numberOfLines, undefined);
    assert.equal(web.StyleSheet.flatten(label.props.style).width, "100%");
    assert.equal(barStyle.height, undefined); // Large text may grow the bar rather than clip.
    tab.props.onLongPress!();
  }
  assert.deepEqual(
    events.map((event) => [event.type, event.target]),
    [
      ["tabLongPress", "index"],
      ["tabLongPress", "spaces"],
      ["tabLongPress", "tasks"],
    ],
  );
});

test("each navigation item opens its own route with reference Home/Spaces icons and a distinct task icon", () => {
  for (const [active, expectedIcons] of [
    ["index", ["home", "leaf-outline", "calendar-outline"]],
    ["spaces", ["home-outline", "leaf", "calendar-outline"]],
    ["tasks", ["home-outline", "leaf-outline", "calendar"]],
    ["space-detail", ["home-outline", "leaf", "calendar-outline"]],
  ] as const) {
    const { tree, navigated } = loadNav(active);
    const tabs = children(children(children(tree)[0])[0]);
    assert.deepEqual(tabs.map(tab => tabIcon(tab).props.name), [...expectedIcons]);
    const routes = ["index", "spaces", "tasks"];
    tabs.forEach((tab, index) => {
      assert.equal(tabIcon(tab).props.size, 24);
      assert.equal(tabIcon(tab).props.color, tab.props.accessibilityState?.selected ? "#1B6B36" : "#506557");
      tab.props.onPress!();
      assert.equal(navigated.includes(routes[index]), active !== routes[index]);
    });
  }
});

test("dock respects safe areas and remains centered at the reference width on small screens", () => {
  const { tree } = loadNav("index", { bottom: 0, left: 0, right: 0 });
  const outer = web.StyleSheet.flatten(tree.props.style);
  const dock = web.StyleSheet.flatten(children(tree)[0].props.style);
  assert.equal(outer.bottom, 25);
  for (const screenWidth of [280, 320, 360, 390, 768]) {
    const available = screenWidth - outer.left - outer.right;
    const width = Math.min(dock.width, available);
    const itemWidth = (width - 58 - dock.gap) / 3;
    assert.ok(itemWidth >= 48);
    assert.ok(width <= available);
  }
});

test("installed Router v57 clears retained plant/device targets on the untargeted Scan action", () => {
  // Exercise the actual installed tab reducer, not a mock of parameter merging.
  // This internal import is intentionally version-sensitive regression evidence.
  const root = dirname(loadModule.resolve("expo-router/package.json"));
  const { TabRouter } = loadModule(
    join(root, "build/react-navigation/routers/TabRouter.js"),
  );
  const router = TabRouter({ backBehavior: "history" });
  const options = {
    routeNames: ["index", "garden", "tasks", "scanner"],
    routeParamList: {},
    routeGetIdList: {},
  };
  let state = router.getInitialState(options);
  const navigate = (name: string, params: Record<string, string>) => {
    state = router.getStateForAction(
      state,
      { type: "NAVIGATE", payload: { name, params } },
      options,
    );
    assert.ok(state);
  };
  navigate("scanner", { plantId: "plant-1", deviceId: "sensor-1" });
  navigate("garden", {});
  const scanner = () =>
    state.routes.find((route: { name: string }) => route.name === "scanner");
  assert.equal(scanner().params.plantId, "plant-1");
  assert.equal(scanner().params.deviceId, "sensor-1");
  const { tree, navigated } = loadNav();
  const scan = children(children(tree)[0])[1];
  scan.props.onPress!();
  assert.deepEqual(navigated, ["/(tabs)/scanner"]);
  // getNavigateAction constructs a non-merging NAVIGATE with empty search params
  // for this URL; reproduce that action on the installed JS Tabs reducer.
  navigate("scanner", {});
  assert.equal(scanner().params?.plantId, undefined);
  assert.equal(scanner().params?.deviceId, undefined);
});

test("selected-tab color and emphasis follow Spaces details, reverse selections, and stop for reduced motion", () => {
  const configs: { toValue: number; duration: number; useNativeDriver: boolean; isInteraction: boolean }[] = [];
  let reduced = false;
  let platform = "web";
  let stopped = 0;
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value; }
    stopAnimation() { stopped++; }
    interpolate(config: unknown) { return config; }
  }
  let cursor = 0;
  const refs: { current: Value[] }[] = [];
  const effects: (() => (() => void) | undefined)[] = [];
  let cleanup: (() => void) | undefined;
  const exports: { BottomNav?: (props: unknown) => Element } = {};
  runInNewContext(ts.transpileModule(readFileSync("components/bottom-nav.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return loadModule(name);
      if (name === "react") return {
        useRef(initial: Value[]) { return refs[cursor++] ??= { current: initial }; },
        useEffect(effect: () => (() => void) | undefined) { effects.push(effect); },
      };
      if (name === "@/hooks/use-reduced-motion") return { useReducedMotion: () => reduced };
      if (name === "@/components/animated-pressable") return { AnimatedPressable: "AnimatedPressable" };
      if (name === "@expo/vector-icons") return { Ionicons: "Ionicons" };
      if (name === "expo-router") return { useRouter: () => ({ navigate() {} }) };
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0 }) };
      if (name === "react-native") return {
        ...web,
        Platform: { get OS() { return platform; } },
        Animated: {
          ...web.Animated,
          Value,
          createAnimatedComponent: (component: unknown) => {
            assert.notEqual(component, "Ionicons", "Expo icon refs cannot be driven by Animated");
            return component;
          },
          timing(value: Value, config: typeof configs[number]) {
            configs.push(config);
            return { start: () => value.setValue(config.toValue) };
          },
          parallel(animations: { start: () => void }[]) {
            return { start: () => animations.forEach(animation => animation.start()), stop: () => { stopped++; } };
          },
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const routes = ["index", "spaces", "tasks", "space-detail"].map(name => ({ name, key: name }));
  const render = (active: string) => {
    cursor = 0;
    const tree = exports.BottomNav!({
      state: { routes, index: routes.findIndex(route => route.name === active) },
      navigation: { emit: () => ({ defaultPrevented: false }), navigate() {} },
    });
    effects.splice(0).forEach(effect => { cleanup?.(); cleanup = effect(); });
    return tree;
  };
  for (const [active, expected] of [
    ["index", [1, 0, 0]],
    ["spaces", [0, 1, 0]],
    ["space-detail", [0, 1, 0]],
    ["tasks", [0, 0, 1]],
    ["spaces", [0, 1, 0]],
  ] as const) {
    const tree = render(active);
    assert.deepEqual(Array.from(refs[0].current, value => value.value), [...expected]);
    const tabs = children(children(children(tree)[0])[0]);
    assert.ok(tabs.every(tab => tab.type === "AnimatedPressable"));
    assert.equal(children(children(tree)[0])[1].type, "AnimatedPressable");
    const iconStyle = children(tabs[1])[0].props.style as { transform: { scale: { outputRange: number[] } }[] };
    assert.equal(children(tabs[1])[0].type, web.Animated.View);
    assert.equal(tabIcon(tabs[1]).type, "Ionicons");
    assert.equal(tabIcon(tabs[1]).props.style, undefined);
    assert.equal(typeof tabIcon(tabs[1]).props.color, "string");
    assert.equal(children(tabs[1])[1].type, web.Text);
    const labelColor = web.StyleSheet.flatten(children(tabs[1])[1].props.style).color;
    assert.equal(labelColor, tabs[1].props.accessibilityState?.selected ? "#1B6B36" : "#506557");
    assert.deepEqual(Array.from(iconStyle.transform[0].scale.outputRange), [1, 1.04]);
  }
  assert.ok(configs.every(config => config.duration === 180 && config.useNativeDriver === false && config.isInteraction === false));
  const previousCount = configs.length;
  reduced = true;
  const tree = render("index");
  assert.equal(configs.length, previousCount); // No animation after the OS preference changes.
  assert.ok(stopped >= 1); // Cleanup stops the previous animation; static styles do not mutate values.
  const icon = children(children(children(children(tree)[0])[0])[0])[0];
  const scale = (icon.props.style as { transform: { scale: number }[] }).transform[0].scale;
  assert.equal(scale, 1);
  assert.equal(children(icon)[0].props.color, "#1B6B36");
  const reducedTabs = children(children(children(tree)[0])[0]);
  assert.deepEqual(reducedTabs.map(tab => web.StyleSheet.flatten(children(tab)[1].props.style).color), ["#1B6B36", "#506557", "#506557"]);
  reduced = false;
  for (const os of ["ios", "android"]) {
    platform = os;
    render("spaces");
    assert.ok(configs.slice(-3).every(config => config.useNativeDriver && config.isInteraction === false));
  }
});

test("reduced-motion startup and tab changes render static selection without resetting animated values", () => {
  class UntouchedValue extends web.Animated.Value {
    setValue() { throw new Error("Reduced motion must not reset an animated value"); }
    stopAnimation() { throw new Error("No animation was started"); }
    interpolate() { throw new Error("Reduced motion must render static styles"); }
  }
  let ref: { current: unknown } | undefined;
  const effects: (() => void)[] = [];
  const exports: { BottomNav?: (props: unknown) => Element } = {};
  runInNewContext(ts.transpileModule(readFileSync("components/bottom-nav.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return loadModule(name);
      if (name === "react") return {
        useRef: (value: unknown) => ref ??= { current: value },
        useEffect: (effect: () => void) => effects.push(effect),
      };
      if (name === "react-native") return { ...web, Animated: { ...web.Animated, Value: UntouchedValue } };
      if (name === "@/hooks/use-reduced-motion") return { useReducedMotion: () => true };
      if (name === "@/components/animated-pressable") return { AnimatedPressable: web.Pressable };
      if (name === "@expo/vector-icons") return { Ionicons: () => null };
      if (name === "expo-router") return { useRouter: () => ({ navigate() {} }) };
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0 }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const routes = ["index", "spaces", "tasks", "space-detail"].map(name => ({ name, key: name }));
  for (const active of ["index", "space-detail", "tasks"]) {
    const tree = exports.BottomNav!({
      state: { routes, index: routes.findIndex(route => route.name === active) },
      navigation: { emit: () => ({ defaultPrevented: false }), navigate() {} },
    });
    assert.doesNotThrow(() => effects.splice(0).forEach(effect => effect()));
    const tabs = children(children(children(tree)[0])[0]);
    tabs.forEach(tab => {
      const expected = tab.props.accessibilityState?.selected ? "#1B6B36" : "#506557";
      const iconStyle = web.StyleSheet.flatten(children(tab)[0].props.style);
      assert.equal(tabIcon(tab).props.color, expected);
      assert.equal(iconStyle.transform[0].scale, 1);
      assert.equal(web.StyleSheet.flatten(children(tab)[1].props.style).color, expected);
    });
  }
});

test("installed tab history reverses navigation without losing the Space Details target", () => {
  const root = dirname(loadModule.resolve("expo-router/package.json"));
  const { TabRouter } = loadModule(join(root, "build/react-navigation/routers/TabRouter.js"));
  const router = TabRouter({ backBehavior: "history" });
  const options = {
    routeNames: ["index", "spaces", "tasks", "space-detail", "scanner"],
    routeParamList: {}, routeGetIdList: {},
  };
  let state = router.getInitialState(options);
  const dispatch = (action: unknown) => {
    state = router.getStateForAction(state, action, options);
    assert.ok(state);
    return state.routes[state.index].name;
  };
  assert.equal(dispatch({ type: "NAVIGATE", payload: { name: "spaces" } }), "spaces");
  assert.equal(dispatch({ type: "NAVIGATE", payload: { name: "space-detail", params: { spaceId: "space-1" } } }), "space-detail");
  assert.equal(dispatch({ type: "GO_BACK" }), "spaces");
  assert.equal(dispatch({ type: "NAVIGATE", payload: { name: "tasks" } }), "tasks");
  assert.equal(dispatch({ type: "GO_BACK" }), "spaces");
  assert.equal(dispatch({ type: "GO_BACK" }), "index");
  assert.equal(state.routes.find((route: { name: string }) => route.name === "space-detail").params.spaceId, "space-1");
});
