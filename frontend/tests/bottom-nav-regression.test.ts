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
  accessibilityLabel?: string;
  onPress?: () => void;
  onLongPress?: () => void;
};
type Element = React.ReactElement<Props>;
function children(node: Element): Element[] {
  return React.Children.toArray(node.props.children).filter(
    React.isValidElement<Props>,
  );
}
function loadNav() {
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
        if (name === "react-native") return web;
        if (name === "@expo/vector-icons") return { Ionicons: () => null };
        if (name === "expo-router")
          return {
            useRouter: () => ({
              navigate: (path: string) => navigated.push(path),
            }),
          };
        if (name === "react-native-safe-area-context")
          return {
            useSafeAreaInsets: () => ({ bottom: 24, left: 44, right: 0 }),
          };
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  const tree = exports.BottomNav!({
    state: {
      index: 0,
      routes: ["index", "garden", "tasks", "scanner"].map((name) => ({
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

test("Scan occupies the center between equal side groups with safe-area and tap-target space", () => {
  const { tree, events } = loadNav();
  const outer = web.StyleSheet.flatten(tree.props.style);
  assert.equal(outer.bottom, 36);
  assert.equal(outer.left, 44);
  assert.equal(outer.right, 44);
  const [bar] = children(tree);
  const [left, scan, right] = children(bar);
  assert.equal(children(bar).length, 3);
  assert.equal(scan.props.accessibilityLabel, "Scan Plant");
  const leftStyle = web.StyleSheet.flatten(left.props.style);
  const rightStyle = web.StyleSheet.flatten(right.props.style);
  assert.equal(leftStyle.flex, 1);
  assert.equal(leftStyle.flexBasis, 0);
  assert.deepEqual(leftStyle, rightStyle);
  const scanStyle = web.StyleSheet.flatten(scan.props.style);
  assert.equal(scanStyle.width, 60);
  assert.equal(scanStyle.flexShrink, 0);
  assert.ok(scanStyle.minHeight >= 48);
  assert.ok(scanStyle.marginTop < 0);
  const tabs = [...children(left), ...children(right)];
  assert.deepEqual(
    tabs.map((tab) => tab.props.accessibilityLabel),
    ["Home", "My Garden", "Care Tasks"],
  );
  for (const tab of tabs) {
    const style = web.StyleSheet.flatten(tab.props.style);
    assert.ok(style.minWidth >= 48);
    assert.ok(style.minHeight >= 48);
    tab.props.onLongPress!();
  }
  assert.deepEqual(
    events.map((event) => [event.type, event.target]),
    [
      ["tabLongPress", "index"],
      ["tabLongPress", "garden"],
      ["tabLongPress", "tasks"],
    ],
  );
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
