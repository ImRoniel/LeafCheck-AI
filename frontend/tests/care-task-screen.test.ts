import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import * as careTasks from "../services/care-tasks";
import * as careTaskFilter from "../services/care-task-filter";
import * as careTaskPresentation from "../services/care-task-presentation";
import { createLocalStateStore, localStateKey } from "../services/local-state-storage";
import type { Plant } from "../types/plant";
import type { CareTask } from "../types/scan";

const requireModule = createRequire(`${process.cwd()}/package.json`);
type Props = { children?: React.ReactNode; accessibilityLabel?: string; accessibilityRole?: string; onPress?: () => void; label?: string; refresh?: () => void; style?: Record<string, any> | Record<string, any>[]; accessibilityState?: { expanded?: boolean; disabled?: boolean } };
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : []);
}
async function harness(guest = true, width = 390, reducedMotion = false) {
  let raw: string | null = null;
  let fail = false;
  let localReady = true;
  const store = createLocalStateStore({ getItem: async () => raw, setItem: async (_key, value) => {
    if (fail) throw new Error("Disk full"); raw = value;
  } }, localStateKey(guest ? null : "account"));
  await store.load();
  const plant: Plant = { id: guest ? "guest-1" : "p1", name: "Fern", species: "Fern", location: "Bedroom", healthStatus: "unknown",
    createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z", lastScannedAt: "2026-09-01T08:00:00Z" };
  const data = { plants: [plant], guest, loaded: true, loading: false, error: null as string | null, refresh: async () => { refreshed++; } };
  let refreshed = 0;
  const accountWrites: [string, string][] = [];
  let remoteFail = false;
  const remote = {
    tasks: [] as CareTask[], loading: false, saving: false, error: null as Error | null,
    refresh: async () => { refreshed++; },
    update: async (id: string, completed: boolean) => {
      accountWrites.push([id, completed ? "COMPLETED" : "PENDING"]);
      if (remoteFail) throw new Error("offline");
      remote.tasks = remote.tasks.map(task => task.id === id ? { ...task, status: completed ? "COMPLETED" : "PENDING", completedAt: completed ? new Date().toISOString() : null } : task);
    },
    skip: async (id: string) => {
      accountWrites.push([id, "SKIPPED"]);
      if (remoteFail) throw new Error("offline");
      remote.tasks = remote.tasks.map(task => task.id === id ? { ...task, status: "SKIPPED" } : task);
    },
  };
  const enabled: boolean[] = [];
  const navigated: unknown[] = [];
  let filterAnimations = 0;
  let cursor = 0;
  const slots: unknown[] = [];
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
  };
  const exports: { default?: () => React.ReactNode } = {};
  runInNewContext(ts.transpileModule(readFileSync("app/(tabs)/tasks.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require(name: string) {
      if (name === "react/jsx-runtime") return requireModule(name);
      if (name === "react") return react;
      if (name === "react-native") return { View: "View", Image: "Image", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", useWindowDimensions: () => ({ width, height: 844 }), Platform: { OS: "web" }, UIManager: {}, LayoutAnimation: { configureNext() { filterAnimations++; }, Presets: { easeInEaseOut: {} } }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } } };
      if (name === "@expo/vector-icons") return { Ionicons: "Icon" };
      if (name === "@/components/screen") return { Screen: "Screen", Action: "Action", Notice: "Notice" };
      if (name === "@/components/care-task-thumbnail") return { CareTaskThumbnail: "CareTaskThumbnail" };
      if (name === "@/components/animated-pressable") return { AnimatedPressable: "Pressable" };
      if (name === "@/context/app-data") return { useAppData: () => data };
      if (name === "@/context/local-state") return { useLocalState: () => ({ ...store.snapshot(), ready: localReady && store.snapshot().ready, update: store.update }) };
      if (name === "@/hooks/use-care-tasks") return { useCareTasks: (value: boolean) => { enabled.push(value); return remote; } };
      if (name === "@/hooks/use-reduced-motion") return { useReducedMotion: () => reducedMotion };
      if (name === "@/services/care-tasks") return careTasks;
      if (name === "@/services/care-task-filter") return careTaskFilter;
      if (name === "@/services/care-task-presentation") return careTaskPresentation;
      if (name === "expo-router") return { useFocusEffect: () => {}, useRouter: () => ({ push: (route: unknown) => navigated.push(route), navigate: (route: unknown) => navigated.push(route) }) };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () => { cursor = 0; return elements(exports.default!()); };
  const press = (label: string) => {
    const node = render().find(node => node.props.accessibilityLabel === label || node.props.label === label);
    assert.ok(node, label); node.props.onPress!();
  };
  const completedView = () => render().find(node => node.props.accessibilityRole === "tab" && elements(node.props.children).some(text => String(text.props.children).startsWith("Completed")))!.props.onPress!();
  const task = (status = "PENDING"): CareTask => ({ id: "t1", plantId: plant.id, title: "Water if soil is dry", taskType: "WATERING", description: "Check the soil first.", status, urgency: "routine",
    dueDate: new Date(Date.now() - 86_400_000).toISOString(), completedAt: status === "COMPLETED" ? new Date().toISOString() : null, createdAt: plant.createdAt, plant: null });
  return { store, data, remote, accountWrites, enabled, navigated, render, press, completedView, task,
    failLocal: (value: boolean) => { fail = value; }, localReady: (value: boolean) => { localReady = value; }, failRemote: (value: boolean) => { remoteFail = value; }, refreshed: () => refreshed, filterAnimations: () => filterAnimations };
}

test("Guest task controls persist completion/undo, retain pending tasks on failure and open the selected space", async () => {
  const h = await harness();
  h.remote.tasks = [h.task()]; // Even a retained account list must never be rendered for a guest.
  assert.ok(!h.render().some(node => String(node.props.children).includes("Water if soil is dry")));
  assert.ok(h.enabled.every(value => value === false));
  assert.ok(!h.render().some(node => node.props.accessibilityLabel?.startsWith("Skip")));
  h.failLocal(true);
  h.press("Complete Check soil moisture for Fern");
  await nextTurn();
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
  assert.ok(h.render().some(node => String(node.props.children).includes("checklist is unchanged")));
  h.failLocal(false);
  h.press("Complete Check soil moisture for Fern");
  await nextTurn();
  assert.equal(h.store.snapshot().data.careCompletions.length, 1);
  h.completedView();
  h.failLocal(true);
  h.press("Undo Check soil moisture for Fern");
  await nextTurn();
  assert.equal(h.store.snapshot().data.careCompletions.length, 1);
  h.failLocal(false);
  h.press("Undo Check soil moisture for Fern");
  await nextTurn();
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
  h.press("Show pending care tasks");
  h.press("Open Fern space");
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigated)), [{ pathname: "/(tabs)/space-detail", params: { space: "Bedroom" } }]);
  assert.equal(h.accountWrites.length, 0);
});

test("account Skip uses only the server source, leaves failed tasks visible and removes confirmed skips", async () => {
  const h = await harness(false);
  h.remote.tasks = [h.task()];
  h.failRemote(true);
  h.press("Skip Water if soil is dry for Fern");
  await nextTurn();
  assert.equal(h.remote.tasks[0].status, "PENDING");
  assert.ok(h.render().some(node => String(node.props.children).includes("Could not confirm the account update")));
  h.failRemote(false);
  h.press("Skip Water if soil is dry for Fern");
  await nextTurn();
  assert.equal(h.remote.tasks[0].status, "SKIPPED");
  assert.ok(!h.render().some(node => node.props.accessibilityLabel?.startsWith("Skip")));
  assert.deepEqual(h.accountWrites, [["t1", "SKIPPED"], ["t1", "SKIPPED"]]);
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
  h.press("Open Fern plant profile");
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigated)), [{ pathname: "/plant-profile", params: { id: "p1" } }]);
});

test("account completion and Undo send COMPLETED and PENDING without writing local history", async () => {
  const h = await harness(false);
  h.remote.tasks = [h.task()];
  h.press("Complete Water if soil is dry for Fern");
  await nextTurn();
  h.completedView();
  h.press("Undo Water if soil is dry for Fern");
  await nextTurn();
  assert.deepEqual(h.accountWrites, [["t1", "COMPLETED"], ["t1", "PENDING"]]);
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
});

test("loading and partial refresh failure have retry controls without a false empty success", async () => {
  const h = await harness(false);
  h.data.loaded = false;
  h.data.loading = true;
  assert.ok(h.render().some(node => node.type === "ActivityIndicator"));
  h.data.loading = false;
  h.data.loaded = true;
  h.data.plants = [];
  h.remote.error = new Error("offline");
  assert.ok(!h.render().some(node => node.props.children === "All Caught Up!"));
  h.press("Retry scan tasks");
  await nextTurn();
  assert.equal(h.refreshed(), 1);
  h.remote.error = null;
  assert.ok(h.render().some(node => node.props.children === "All Caught Up!"));
  assert.ok(!h.render().some(node => node.props.accessibilityLabel === "Open My Spaces"));
});

test("pull-to-refresh remains wired and three interactive summary cards show readable real counts", async () => {
  const h = await harness(false);
  assert.ok(!h.render().some(node => node.props.accessibilityLabel === "Refresh care tasks"));
  const screen = h.render().find(node => node.type === "Screen")!;
  assert.equal(typeof screen.props.refresh, "function");
  screen.props.refresh!();
  await nextTurn();
  assert.equal(h.refreshed(), 2); // Plants and account tasks both refresh.
  const row = h.render().find(node => {
    const children = React.Children.toArray(node.props.children) as React.ReactElement<Props>[];
    return children.length === 3 && children.every(child => child?.props?.accessibilityRole === "button") &&
      elements(children[2]).some(text => text.props.children === "Due today");
  });
  assert.ok(row);
  const cards = React.Children.toArray(row.props.children) as React.ReactElement<Props>[];
  assert.equal(cards[0].props.accessibilityLabel, "Show pending tasks: 2");
  assert.equal(cards[1].props.accessibilityLabel, "Show completed tasks: 0");
  assert.equal(cards[2].props.accessibilityLabel, "Show tasks due today: 0");
  const styles = cards[2].props.style as Record<string, any>[];
  const color = styles[1].backgroundColor;
  const label = elements(cards[2]).find(node => node.props.children === "Due today")!;
  const textColor = (label.props.style as Record<string, any>[])[1].color;
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(channel => { const value = parseInt(channel, 16) / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  assert.ok((luminance(color) + 0.05) / (luminance(textColor) + 0.05) >= 4.5);
  assert.ok(!h.render().some(node => typeof node.props.children === "string" && /Local care · Saved|Mark care you’ve done|Pull down to refresh/.test(node.props.children)));
});

test("direct task buttons are text-only and offer only supported pending/completed actions", async () => {
  const guest = await harness();
  const control = guest.render().find(node => node.props.accessibilityLabel === "Complete Check soil moisture for Fern")!;
  assert.equal(elements(control.props.children).length, 1);
  assert.equal(elements(control.props.children)[0].props.children, "Mark as done");
  const styles = control.props.style as Record<string, any>[];
  assert.ok(styles[0].minHeight >= 44);
  assert.ok(!guest.render().some(node => node.props.accessibilityLabel?.startsWith("Actions for")));
  assert.ok(!guest.render().some(node => node.props.accessibilityLabel?.startsWith("Skip")));
  guest.press("Complete Check soil moisture for Fern");
  await nextTurn();
  guest.completedView();
  const undo = guest.render().find(node => node.props.accessibilityLabel === "Undo Check soil moisture for Fern")!;
  assert.equal(elements(undo.props.children)[0].props.children, "Undo");
  assert.ok(!guest.render().some(node => node.props.accessibilityLabel?.startsWith("Complete") || node.props.accessibilityLabel?.startsWith("Skip")));
  const account = await harness(false);
  account.remote.tasks = [account.task()];
  assert.ok(account.render().some(node => node.props.accessibilityLabel === "Skip Water if soil is dry for Fern"));
});

test("empty states fill the remaining screen and have no My Spaces action", async () => {
  const h = await harness();
  h.data.plants = [];
  const empty = h.render().find(node => React.Children.toArray(node.props.children).some(child => React.isValidElement<Props>(child) && child.props.children === "All Caught Up!"))!;
  assert.equal((empty.props.style as Record<string, string>).alignItems, "center");
  assert.equal((empty.props.style as Record<string, string>).justifyContent, "center");
  assert.equal((empty.props.style as Record<string, number>).flex, 1);
  assert.ok(elements(empty).some(node => node.props.children === "No Pending Tasks."));
  assert.ok(!h.render().some(node => node.props.accessibilityLabel === "Open My Spaces"));
  h.completedView();
  assert.ok(h.render().some(node => node.props.children === "No Completed Task!"));
});

test("green period dropdown switches task views without changing persistent task sources", async () => {
  const h = await harness(false);
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 7 - (date.getDay() + 6) % 7);
  h.remote.tasks = [{ ...h.task(), title: "Next week care", dueDate: date.toISOString() }];
  assert.ok(!h.render().some(node => node.props.children === "Next week care"));
  h.press("Filter care tasks");
  h.press("Show Next Week tasks");
  assert.ok(h.render().some(node => node.props.children === "Next week care"));
  assert.ok(!h.render().some(node => node.props.accessibilityLabel === "Show Later tasks"));
  assert.equal(h.accountWrites.length, 0);
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
});

test("Care Tasks filter remains interactive without animation when reduced motion is enabled", async () => {
  for (const reducedMotion of [false, true]) {
    const h = await harness(true, 320, reducedMotion);
    h.press("Filter care tasks");
    assert.equal(h.render().find(node => node.props.accessibilityLabel === "Filter care tasks")!.props.accessibilityState!.expanded, true);
    h.press("Show Next Week tasks");
    assert.equal(h.render().find(node => node.props.accessibilityLabel === "Filter care tasks")!.props.accessibilityState!.expanded, false);
    assert.ok(h.render().some(node => node.props.children === "Next Week"));
    assert.equal(h.filterAnimations(), reducedMotion ? 0 : 2);
    assert.equal(h.accountWrites.length, 0);
    assert.equal(h.store.snapshot().data.careCompletions.length, 0);
  }
});

test("Care Tasks uses a clean white page without decorative artwork and retains real plant thumbnails", async () => {
  const h = await harness();
  h.data.plants[0].imageUrl = "https://images.test/fern.jpg";
  assert.equal((h.render()[0].props.style as Record<string, unknown>).backgroundColor, "#FFFFFF");
  assert.equal((h.render().find(node => node.type === "Screen")!.props as any).backgroundColor, "#FFFFFF");
  assert.ok(!h.render().some(node => node.type === "Image"));
  const thumbnail = h.render().find(node => node.type === "CareTaskThumbnail")!;
  assert.equal((thumbnail.props as any).uri, h.data.plants[0].imageUrl);
  assert.equal((thumbnail.props as any).name, "Fern");
  h.data.plants[0].imageUrl = undefined;
  assert.equal((h.render().find(node => node.type === "CareTaskThumbnail")!.props as any).uri, undefined);
});

test("summary due-today filter includes earlier-today Overdue and excludes manual, yesterday, and tomorrow tasks", async () => {
  const h = await harness(false);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const tomorrow = new Date(midnight); tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(midnight); yesterday.setDate(yesterday.getDate() - 1);
  h.remote.tasks = [
    { ...h.task(), id: "earlier", title: "Earlier today care", dueDate: midnight.toISOString() },
    { ...h.task(), id: "later", title: "Later today care", dueDate: new Date(tomorrow.getTime() - 1).toISOString() },
    { ...h.task(), id: "tomorrow", title: "Tomorrow care", dueDate: tomorrow.toISOString() },
    { ...h.task(), id: "yesterday", title: "Yesterday care", dueDate: yesterday.toISOString() },
  ];
  h.press("Show tasks due today: 2");
  assert.ok(h.render().some(node => node.props.children === "Earlier today care"));
  assert.ok(h.render().some(node => node.props.children === "Later today care"));
  assert.ok(!h.render().some(node => ["Check soil moisture", "Tomorrow care", "Yesterday care"].includes(String(node.props.children))));
  assert.ok(h.render().some(node => node.props.children === "Overdue"));
  assert.equal(h.accountWrites.length, 0);
});

test("All, Pending and Completed views share confirmed counts without changing task sources", async () => {
  const h = await harness();
  h.press("Show pending tasks: 2");
  h.failLocal(true); h.press("Complete Check soil moisture for Fern"); await nextTurn();
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Show pending tasks: 2"));
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Show completed tasks: 0"));
  h.failLocal(false); h.press("Complete Check soil moisture for Fern"); await nextTurn();
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Show pending tasks: 1"));
  h.press("Show completed tasks: 1");
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Undo Check soil moisture for Fern"));
  assert.ok(!h.render().some(node => node.props.accessibilityLabel === "Complete Check light conditions for Fern"));
  h.press("Show all care tasks");
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Undo Check soil moisture for Fern"));
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Complete Check light conditions for Fern"));
  h.press("Show pending care tasks");
  assert.ok(!h.render().some(node => node.props.accessibilityLabel === "Undo Check soil moisture for Fern"));
  assert.equal(h.accountWrites.length, 0);
});

test("short previews can expand to the original saved details without marking care complete", async () => {
  const h = await harness(false);
  const details = "Check the soil before watering. " + "Review the saved recommendation before acting. ".repeat(6);
  h.remote.tasks = [{ ...h.task(), description: details }];
  assert.ok(h.render().some(node => node.props.children === "Check the soil before watering."));
  h.press("Show details for Water if soil is dry");
  assert.ok(h.render().some(node => node.props.children === details.trim()));
  h.press("Hide details for Water if soil is dry");
  assert.ok(!h.render().some(node => node.props.children === details.trim()));
  assert.equal(h.accountWrites.length, 0);
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
});

test("account plant loading cannot show an empty success before local schedules and history hydrate", async () => {
  const h = await harness(false);
  h.data.plants = [];
  h.localReady(false);
  assert.ok(h.render().some(node => node.type === "ActivityIndicator"));
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Show pending tasks: loading"));
  assert.ok(!h.render().some(node => node.props.children === "All Caught Up!"));
  h.localReady(true);
  assert.ok(h.render().some(node => node.props.children === "All Caught Up!"));
});
