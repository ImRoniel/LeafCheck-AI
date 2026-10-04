import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";

const requireModule = createRequire(`${process.cwd()}/package.json`);

function hookState() {
  let cursor = 0;
  let updates = 0;
  const slots: any[] = [];
  const pending: (() => void)[] = [];
  return {
    reset: () => { cursor = 0; },
    flush: () => { pending.splice(0).forEach(effect => effect()); },
    unmount: () => { slots.forEach(slot => slot?.cleanup?.()); },
    updates: () => updates,
    react: {
      forwardRef: React.forwardRef,
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
        return [slots[index].value, (value: unknown) => {
          updates++;
          slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
        }];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect(effect: () => void | (() => void), deps: unknown[]) {
        const index = cursor++;
        const previous = slots[index];
        if (previous && deps.every((dep, key) => Object.is(dep, previous.deps[key]))) return;
        const slot = { deps, cleanup: previous?.cleanup };
        slots[index] = slot;
        pending.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
      },
    },
  };
}

function load(path: string, overrides: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require(name: string) {
      if (name in overrides) return overrides[name];
      if (name === "react/jsx-runtime") return requireModule(name);
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

function flatten(style: any): Record<string, any> | undefined {
  if (!style) return undefined;
  if (!Array.isArray(style)) return style;
  return Object.assign({}, ...style.map(flatten));
}

function pressHarness(platform = "ios", initialReduced = false) {
  const state = hookState();
  let reduced = initialReduced;
  const animations: {
    kind: "timing" | "spring";
    options: Record<string, any>;
    started: boolean;
    stops: number;
  }[] = [];
  const animatedComponents: unknown[] = [];
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value; }
  }
  const animate = (kind: "timing" | "spring", value: Value, options: Record<string, any>) => {
    const record = { kind, options, started: false, stops: 0 };
    animations.push(record);
    return {
      start: () => { record.started = true; value.value = options.toValue; },
      stop: () => { record.stops++; },
    };
  };
  const module = load("components/animated-pressable.tsx", {
    react: state.react,
    "@/hooks/use-reduced-motion": { useReducedMotion: () => reduced },
    "react-native": {
      Pressable: "Pressable", Platform: { OS: platform }, StyleSheet: { flatten },
      Animated: {
        Value,
        createAnimatedComponent: (component: unknown) => { animatedComponents.push(component); return "NativePressable"; },
        timing: (value: Value, options: Record<string, any>) => animate("timing", value, options),
        spring: (value: Value, options: Record<string, any>) => animate("spring", value, options),
      },
    },
  });
  const render = (props: Record<string, any>, ref?: unknown): React.ReactElement<any> => {
    state.reset();
    return module.AnimatedPressable.render(props, ref);
  };
  return { render, animations, animatedComponents, state, setReduced: (value: boolean) => { reduced = value; } };
}

test("animated press feedback forwards native measurement refs, accessibility and action callbacks unchanged", () => {
  const h = pressHarness();
  const received: unknown[] = [];
  const event = { nativeEvent: { pageX: 100, pageY: 200 } };
  const ref = { current: { measureInWindow() {} } };
  const onPress = (value: unknown) => { received.push(value); };
  const onLongPress = (value: unknown) => { received.push(value); };
  const props = {
    style: { width: 55, height: 55, borderRadius: 28 },
    accessibilityRole: "button", accessibilityLabel: "Add plant",
    accessibilityState: { expanded: false }, hitSlop: 6, collapsable: false,
    onPress, onLongPress, children: "Add", testID: "add-plant",
    onPressIn: (value: unknown) => { received.push(value); },
    onPressOut: (value: unknown) => { received.push(value); },
  };
  let node = h.render(props, ref);
  h.state.flush();
  assert.deepEqual(h.animatedComponents, ["Pressable"]);
  assert.equal(node.type, "NativePressable");
  assert.equal(node.props.ref, ref);
  assert.equal(node.props.collapsable, false);
  assert.equal(node.props.hitSlop, 6);
  assert.equal(node.props.accessibilityRole, props.accessibilityRole);
  assert.equal(node.props.accessibilityLabel, props.accessibilityLabel);
  assert.equal(node.props.accessibilityState, props.accessibilityState);
  assert.equal(node.props.onPress, onPress);
  assert.equal(node.props.onLongPress, onLongPress);
  assert.equal(node.props.children, "Add");
  assert.equal(node.props.style[0], props.style);
  assert.equal(node.props.style[1].transform.at(-1).scale.value, 1);
  node.props.onPressIn(event);
  node.props.onPress(event); // The action is not delayed until an animation finishes.
  node.props.onLongPress(event);
  node = h.render(props, ref);
  node.props.onPressOut(event);
  assert.equal(received.length, 4);
  assert.ok(received.every(value => value === event));
});

test("web accessibility states map to ARIA without overriding explicit false values or altering native states", () => {
  const accessibilityState = { busy: true, checked: "mixed", disabled: true, expanded: true, selected: true };
  const h = pressHarness("web");
  let node = h.render({ accessibilityState });
  assert.equal(node.props.accessibilityState, accessibilityState);
  assert.equal(node.props["aria-busy"], true);
  assert.equal(node.props["aria-checked"], "mixed");
  assert.equal(node.props["aria-disabled"], true);
  assert.equal(node.props["aria-expanded"], true);
  assert.equal(node.props["aria-selected"], true);
  const explicit = { "aria-busy": false, "aria-checked": false, "aria-disabled": false, "aria-expanded": false, "aria-selected": false };
  node = h.render({ accessibilityState, ...explicit });
  for (const property of Object.keys(explicit)) assert.equal(node.props[property], false);
  assert.equal(node.props.accessibilityState, accessibilityState);
  for (const platform of ["ios", "android"]) {
    const native = pressHarness(platform).render({ accessibilityState });
    assert.equal(native.props.accessibilityState, accessibilityState);
    for (const property of Object.keys(explicit)) assert.equal(Object.hasOwn(native.props, property), false);
  }
});

test("pressed style callbacks and existing transforms remain intact through subtle compression and spring release", () => {
  const h = pressHarness();
  const states: boolean[] = [];
  const props = {
    style: ({ pressed }: { pressed: boolean }) => {
      states.push(pressed);
      return [{ width: 55 }, { backgroundColor: pressed ? "#17633A" : "#278448", transform: [{ translateX: 3 }, { rotate: "2deg" }] }];
    },
  };
  let node = h.render(props);
  h.state.flush();
  assert.equal(flatten(node.props.style)!.backgroundColor, "#278448");
  node.props.onPressIn({});
  node = h.render(props);
  assert.equal(flatten(node.props.style)!.backgroundColor, "#17633A");
  assert.equal(node.props.style[1].transform[0].translateX, 3);
  assert.equal(node.props.style[1].transform[1].rotate, "2deg");
  assert.equal(node.props.style[1].transform.at(-1).scale.value, 0.97);
  assert.equal(h.animations[0].kind, "timing");
  assert.equal(h.animations[0].options.duration, 85);
  assert.equal(h.animations[0].options.isInteraction, false);
  node.props.onPressOut({});
  node = h.render(props);
  assert.equal(flatten(node.props.style)!.backgroundColor, "#278448");
  assert.equal(h.animations[0].stops, 1);
  const release = h.animations[1];
  assert.equal(release.kind, "spring");
  assert.equal(release.options.toValue, 1);
  assert.equal(release.options.damping, 24);
  assert.equal(release.options.stiffness, 330);
  assert.equal(release.options.mass, 0.7);
  assert.equal(release.options.isInteraction, false);
  assert.equal(node.props.style[1].transform.at(-1).scale.value, 1);
  assert.deepEqual(states, [false, true, false]);
  h.state.unmount();
  assert.equal(release.stops, 1);
});

test("feedback uses native animation on iOS and Android, and a web animation driver in the browser", () => {
  for (const platform of ["ios", "android", "web"]) {
    const h = pressHarness(platform);
    const node = h.render({});
    h.state.flush();
    node.props.onPressIn({});
    node.props.onPressOut({});
    assert.equal(h.animations.length, 2);
    assert.ok(h.animations.every(animation => animation.started));
    assert.ok(h.animations.every(animation => animation.options.useNativeDriver === (platform !== "web")));
  }
});

test("web hover state and hover callbacks remain interactive alongside pressed feedback", () => {
  const h = pressHarness("web");
  const received: unknown[] = [];
  const hoverIn = { nativeEvent: { target: "button" } };
  const hoverOut = { nativeEvent: { target: null } };
  const props = {
    style: ({ pressed, hovered }: { pressed: boolean; hovered: boolean }) => ({ backgroundColor: pressed ? "#17633A" : hovered ? "#EAF7EE" : "#FFFFFF" }),
    onHoverIn: (event: unknown) => received.push(event),
    onHoverOut: (event: unknown) => received.push(event),
  };
  let node = h.render(props);
  h.state.flush();
  node.props.onHoverIn(hoverIn);
  node = h.render(props);
  assert.equal(flatten(node.props.style)!.backgroundColor, "#EAF7EE");
  assert.equal(h.animations.length, 0); // Hover must not trigger press compression.
  node.props.onPressIn({});
  node = h.render(props);
  assert.equal(flatten(node.props.style)!.backgroundColor, "#17633A");
  node.props.onPressOut({});
  node = h.render(props);
  assert.equal(flatten(node.props.style)!.backgroundColor, "#EAF7EE");
  node.props.onHoverOut(hoverOut);
  node = h.render(props);
  assert.equal(flatten(node.props.style)!.backgroundColor, "#FFFFFF");
  assert.deepEqual(received, [hoverIn, hoverOut]);
});

test("disabled and reduced-motion buttons retain readable pressed styling without scale animations", () => {
  for (const mode of ["disabled", "reduced"]) {
    const h = pressHarness("ios", mode === "reduced");
    const props = { disabled: mode === "disabled", style: ({ pressed }: { pressed: boolean }) => ({ opacity: pressed ? 0.8 : 1 }) };
    let node = h.render(props);
    h.state.flush();
    node.props.onPressIn({});
    node = h.render(props);
    assert.equal(node.props.disabled, mode === "disabled");
    assert.equal(flatten(node.props.style)!.opacity, mode === "reduced" ? 0.8 : 1);
    node.props.onPressOut({});
    node = h.render(props);
    assert.equal(flatten(node.props.style)!.opacity, 1);
    assert.equal(node.props.style[1].transform.at(-1).scale.value, 1);
    assert.deepEqual(h.animations, []);
  }
});

test("changing motion preference or disabling a held button cancels its running feedback", () => {
  for (const mode of ["disabled", "reduced"]) {
    const h = pressHarness();
    const props = { disabled: false };
    h.render(props);
    h.state.flush();
    h.render(props).props.onPressIn({});
    const active = h.animations[0];
    if (mode === "disabled") props.disabled = true;
    else h.setReduced(true);
    h.render(props);
    h.state.flush();
    const node = h.render(props);
    assert.ok(active.stops > 0);
    assert.equal(node.props.style[1].transform.at(-1).scale.value, 1);
    node.props.onPressOut({});
    assert.equal(h.animations.length, 1);
  }
});

test("string CSS transforms are preserved instead of overwritten by native transform feedback", () => {
  const h = pressHarness("web");
  const style = { transform: "rotate(2deg)", backgroundColor: "#278448" };
  const node = h.render({ style });
  assert.equal(node.props.style[0], style);
  assert.equal(node.props.style[1], undefined);
  assert.equal(flatten(node.props.style)!.transform, "rotate(2deg)");
});

function reducedMotionHarness() {
  const state = hookState();
  let listener!: (value: boolean) => void;
  let resolve!: (value: boolean) => void;
  let reject!: (reason: Error) => void;
  let queries = 0;
  let subscriptions = 0;
  let removed = 0;
  const preference = new Promise<boolean>((done, fail) => { resolve = done; reject = fail; });
  const module = load("hooks/use-reduced-motion.ts", {
    react: state.react,
    "react-native": { AccessibilityInfo: {
      isReduceMotionEnabled: () => { queries++; return preference; },
      addEventListener: (event: string, callback: (value: boolean) => void) => {
        assert.equal(event, "reduceMotionChanged");
        subscriptions++;
        listener = callback;
        return { remove: () => { removed++; } };
      },
    } },
  });
  const render = () => { state.reset(); return module.useReducedMotion(); };
  return { render, state, resolve, reject, change: (value: boolean) => listener(value), queries: () => queries, subscriptions: () => subscriptions, removed: () => removed };
}

test("reduced motion stays conservative until the initial device preference is known", async () => {
  for (const preference of [false, true]) {
    const h = reducedMotionHarness();
    assert.equal(h.render(), true);
    h.state.flush();
    h.resolve(preference);
    await nextTurn();
    assert.equal(h.render(), preference);
    h.state.flush();
    assert.equal(h.queries(), 1);
    assert.equal(h.subscriptions(), 1);
  }
});

test("live reduced-motion changes override an older in-flight preference query", async () => {
  const h = reducedMotionHarness();
  assert.equal(h.render(), true);
  h.state.flush();
  h.change(false);
  assert.equal(h.render(), false);
  h.resolve(true);
  await nextTurn();
  assert.equal(h.render(), false);
  h.change(true);
  assert.equal(h.render(), true);
});

test("preference failures keep motion disabled while live preference changes still work", async () => {
  const h = reducedMotionHarness();
  assert.equal(h.render(), true);
  h.state.flush();
  h.reject(new Error("Preference unavailable"));
  await nextTurn();
  assert.equal(h.render(), true);
  h.change(false);
  assert.equal(h.render(), false);
});

test("unmount removes the preference listener and ignores late query and event updates", async () => {
  const h = reducedMotionHarness();
  assert.equal(h.render(), true);
  h.state.flush();
  h.state.unmount();
  assert.equal(h.removed(), 1);
  h.change(false);
  h.resolve(false);
  await nextTurn();
  assert.equal(h.state.updates(), 0);
  assert.equal(h.render(), true);
});
