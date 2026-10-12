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
type Props = { children?: React.ReactNode; accessibilityLabel?: string; accessibilityRole?: string; onPress?: () => void; label?: string; refresh?: () => void; style?: Record<string, unknown> | Record<string, unknown>[]; numberOfLines?: number; animationType?: string; uri?: string; name?: string; backgroundColor?: string; accessibilityState?: { expanded?: boolean; disabled?: boolean } };
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
  let slots: unknown[] = [];
  const componentSlots = new Map<string, unknown[]>();
  const react = {
    useState(initial: unknown) {
      const currentSlots = slots;
      const index = cursor++;
      if (!(index in currentSlots)) currentSlots[index] = typeof initial === "function" ? initial() : initial;
      return [currentSlots[index], (value: unknown) => { currentSlots[index] = typeof value === "function" ? value(currentSlots[index]) : value; }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
  };
  const exports: { default?: () => React.ReactNode } = {};
  const modules = new Map<string, Record<string, unknown>>();
  const load = (file: string): Record<string, unknown> => {
    const cached = modules.get(file);
    if (cached) return cached;
    const result: Record<string, unknown> = {};
    modules.set(file, result);
    evaluate(file, result);
    return result;
  };
  function evaluate(file: string, target: object) {
  runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports: target,
    require(name: string) {
      if (name === "react/jsx-runtime") return requireModule(name);
      if (name === "react") return react;
      if (name === "react-native") return { Modal: "Modal", ScrollView: "ScrollView", View: "View", Image: "Image", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", useWindowDimensions: () => ({ width, height: 844 }), Platform: { OS: "web" }, UIManager: {}, LayoutAnimation: { configureNext() { filterAnimations++; }, Presets: { easeInEaseOut: {} } }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } } };
      if (name === "@expo/vector-icons") return { Ionicons: "Icon" };
      if (name === "@/components/screen") return { Screen: "Screen", Action: "Action", Notice: "Notice" };
      if (name === "@/components/care-task-thumbnail" || name === "./care-task-thumbnail") return { CareTaskThumbnail: "CareTaskThumbnail" };
      if (name === "@/components/animated-pressable" || name === "./animated-pressable") return { AnimatedPressable: "Pressable" };
      if (name === "@/context/app-data") return { useAppData: () => data };
      if (name === "@/context/local-state") return { useLocalState: () => ({ ...store.snapshot(), ready: localReady && store.snapshot().ready, update: store.update }) };
      if (name === "@/hooks/use-care-tasks") return { useCareTasks: (value: boolean) => { enabled.push(value); return remote; } };
      if (name === "@/hooks/use-reduced-motion") return { useReducedMotion: () => reducedMotion };
      if (name === "@/services/care-tasks") return careTasks;
      if (name === "@/services/care-task-filter") return careTaskFilter;
      if (name === "@/services/care-task-presentation") return careTaskPresentation;
      if (name === "expo-router") return { useLocalSearchParams: () => ({}), useFocusEffect: () => {}, useRouter: () => ({ push: (route: unknown) => navigated.push(route), navigate: (route: unknown) => navigated.push(route) }) };
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name.startsWith("@/components/")) return load(`components/${name.slice("@/components/".length)}.tsx`);
      if (name.startsWith("./")) return load(`components/${name.slice(2)}.tsx`);
      throw new Error(`Unexpected import ${name}`);
    },
  });
  }
  evaluate("app/(tabs)/tasks.tsx", exports);
  const render = () => {
    cursor = 0;
    const tree = exports.default!();
    const expand = (node: React.ReactNode, path: string): React.ReactNode => {
      if (typeof node === "string" || typeof node === "number" || node == null) return node;
      return React.Children.map(node, (child, index) => {
      if (!React.isValidElement<Props>(child)) return child;
      const childPath = `${path}/${child.key ?? index}:${typeof child.type === "function" ? child.type.name : String(child.type)}`;
      if (typeof child.type === "function") {
        const previousSlots = slots;
        const previousCursor = cursor;
        slots = componentSlots.get(childPath) ?? [];
        componentSlots.set(childPath, slots);
        cursor = 0;
        const result = (child.type as (props: Props) => React.ReactNode)(child.props);
        slots = previousSlots;
        cursor = previousCursor;
        return expand(result, childPath);
      }
      return React.cloneElement(child, {}, expand(child.props.children, childPath));
    });
    };
    return elements(expand(tree, "root"));
  };
  const press = (label: string) => {
    const node = render().find(node => node.props.accessibilityLabel === label || node.props.label === label);
    assert.ok(node, label); node.props.onPress!();
  };
  const filter = (status: string, period = "All dates") => {
    const button = render().find(node => node.props.accessibilityLabel?.startsWith("Filter care tasks:"));
    assert.ok(button); button.props.onPress!();
    press(`Show ${status} care tasks`);
    press(`Show ${period} tasks`);
    press("Apply task filters");
  };
  const completedView = () => filter("completed");
  const manual = () => {
    const button = render().find(node => node.props.accessibilityLabel?.startsWith("Expand Manual checks"));
    if (button) button.props.onPress!();
  };
  const details = (title: string) => press(`Show details for ${title} for Fern`);
  const task = (status = "PENDING"): CareTask => ({ id: "t1", plantId: plant.id, title: "Water if soil is dry", taskType: "WATERING", description: "Check the soil first.", status, urgency: "routine",
    dueDate: new Date(Date.now() - 86_400_000).toISOString(), completedAt: status === "COMPLETED" ? new Date().toISOString() : null, createdAt: plant.createdAt, plant: null });
  return { store, data, remote, accountWrites, enabled, navigated, render, press, completedView, task, filter, manual, details,
    failLocal: (value: boolean) => { fail = value; }, localReady: (value: boolean) => { localReady = value; }, failRemote: (value: boolean) => { remoteFail = value; }, refreshed: () => refreshed, filterAnimations: () => filterAnimations };
}

test("guest completion and undo persist, failed writes retain tasks, and details open the selected space", async () => {
  const h = await harness();
  h.remote.tasks = [h.task()];
  h.manual();
  assert.ok(!h.render().some(node => node.props.children === "Water if soil is dry"));
  assert.ok(h.enabled.every(value => value === false));
  h.failLocal(true); h.press("Complete Check soil moisture for Fern"); await nextTurn();
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
  assert.ok(h.render().some(node => String(node.props.children).includes("checklist is unchanged")));
  h.failLocal(false); h.press("Complete Check soil moisture for Fern"); await nextTurn();
  assert.equal(h.store.snapshot().data.careCompletions.length, 1);
  assert.ok(h.render().some(node => node.props.children === "Task completed"));
  h.completedView();
  h.failLocal(true); h.press("Undo Check soil moisture for Fern"); await nextTurn();
  assert.equal(h.store.snapshot().data.careCompletions.length, 1);
  h.failLocal(false); h.press("Undo Check soil moisture for Fern"); await nextTurn();
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
  h.filter("pending"); h.manual(); h.details("Check soil moisture");
  assert.ok(!h.render().some(node => node.props.accessibilityLabel?.startsWith("Skip")));
  h.press("Open Fern space");
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigated)), [{ pathname: "/(tabs)/space-detail", params: { space: "Bedroom" } }]);
  assert.equal(h.accountWrites.length, 0);
});

test("account skip lives in details, failed skips retain the sheet, confirmed skips close it", async () => {
  const h = await harness(false); h.remote.tasks = [h.task()];
  assert.ok(!h.render().some(node => node.props.accessibilityLabel?.startsWith("Skip")));
  h.details("Water if soil is dry");
  h.failRemote(true); h.press("Skip Water if soil is dry for Fern"); await nextTurn();
  assert.equal(h.remote.tasks[0].status, "PENDING");
  assert.ok(h.render().some(node => node.type === "Modal"));
  assert.ok(h.render().some(node => String(node.props.children).includes("Could not confirm the account update")));
  h.failRemote(false); h.press("Skip Water if soil is dry for Fern"); await nextTurn();
  assert.equal(h.remote.tasks[0].status, "SKIPPED");
  assert.ok(!h.render().some(node => node.type === "Modal"));
  assert.deepEqual(h.accountWrites, [["t1", "SKIPPED"], ["t1", "SKIPPED"]]);
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
  h.manual(); h.details("Check soil moisture"); h.press("Open Fern plant profile");
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigated)), [{ pathname: "/plant-profile", params: { id: "p1" } }]);
});

test("account completion and undo update only the server source", async () => {
  const h = await harness(false); h.remote.tasks = [h.task()];
  h.press("Complete Water if soil is dry for Fern"); await nextTurn();
  h.completedView(); h.press("Undo Water if soil is dry for Fern"); await nextTurn();
  assert.deepEqual(h.accountWrites, [["t1", "COMPLETED"], ["t1", "PENDING"]]);
  assert.equal(h.store.snapshot().data.careCompletions.length, 0);
});

test("loading and partial refresh errors never show false empty success; refresh remains wired", async () => {
  const h = await harness(false); h.data.loaded = false; h.data.loading = true;
  assert.ok(h.render().some(node => node.type === "ActivityIndicator"));
  assert.ok(h.render().some(node => node.props.children === "Loading task summary…"));
  h.data.loading = false; h.data.loaded = true; h.data.plants = []; h.remote.error = new Error("offline");
  assert.ok(!h.render().some(node => node.props.children === "All caught up"));
  h.press("Retry scan tasks"); await nextTurn(); assert.equal(h.refreshed(), 1);
  h.remote.error = null;
  assert.ok(h.render().some(node => node.props.children === "All caught up"));
  h.render().find(node => node.type === "Screen")!.props.refresh!(); await nextTurn();
  assert.equal(h.refreshed(), 3);
  h.localReady(false);
  assert.ok(!h.render().some(node => node.props.children === "All caught up"));
});

test("compact summary is informational, manual and upcoming sections start collapsed, urgent undated tasks stay visible", async () => {
  const h = await harness(false);
  h.data.plants[0].healthStatus = "warning";
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  h.remote.tasks = [{ ...h.task(), dueDate: tomorrow.toISOString() }];
  assert.ok(h.render().some(node => node.props.children === "0 due today · 4 pending"));
  assert.ok(h.render().some(node => node.props.children === "Inspect plant health"));
  assert.ok(!h.render().some(node => node.props.children === "Check soil moisture"));
  assert.ok(!h.render().some(node => node.props.children === "Water if soil is dry"));
  h.press("Expand Upcoming, 1 tasks");
  assert.ok(h.render().some(node => node.props.children === "Water if soil is dry"));
  h.manual();
  assert.ok(h.render().some(node => node.props.children === "Check soil moisture"));
  assert.ok(!h.render().some(node => node.props.accessibilityLabel?.startsWith("Show pending tasks:")));
});

test("rows have two-line previews and Details/Done; full instructions appear only in a sheet", async () => {
  const h = await harness(false);
  const details = "Check the soil before watering. " + "Review the saved recommendation before acting. ".repeat(6);
  h.remote.tasks = [{ ...h.task(), description: details }];
  const preview = h.render().find(node => node.props.children === "Check the soil before watering.")!;
  assert.equal(preview.props.numberOfLines, 2);
  const done = h.render().find(node => node.props.accessibilityLabel === "Complete Water if soil is dry for Fern")!;
  assert.ok(elements(done.props.children).some(node => node.props.children === "Done"));
  assert.ok(!h.render().some(node => node.props.children === details.trim()));
  h.details("Water if soil is dry");
  assert.ok(h.render().some(node => node.type === "Modal"));
  assert.ok(h.render().some(node => node.props.children === details.trim()));
  h.press("Close sheet");
  assert.ok(!h.render().some(node => node.props.children === details.trim()));
  assert.equal(h.accountWrites.length, 0);
});

test("filters apply status and time together, cancel discards drafts, and Today includes earlier-today overdue", async () => {
  const h = await harness(false);
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const tomorrow = new Date(midnight); tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(midnight); yesterday.setDate(yesterday.getDate() - 1);
  h.remote.tasks = [
    { ...h.task(), id: "earlier", title: "Earlier today care", dueDate: midnight.toISOString() },
    { ...h.task(), id: "later", title: "Later today care", dueDate: new Date(tomorrow.getTime() - 1).toISOString() },
    { ...h.task(), id: "yesterday", title: "Yesterday care", dueDate: yesterday.toISOString() },
  ];
  h.press("Filter care tasks: Pending · All dates"); h.press("Show completed care tasks"); h.press("Close sheet");
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Filter care tasks: Pending · All dates"));
  h.filter("pending", "Today");
  assert.ok(h.render().some(node => node.props.children === "Earlier today care"));
  assert.ok(h.render().some(node => node.props.children === "Later today care"));
  assert.ok(!h.render().some(node => node.props.children === "Yesterday care"));
  assert.ok(h.render().some(node => node.props.children === "Undated checks are excluded from this view."));
  assert.equal(h.accountWrites.length, 0);
});

test("manual checks progressively reveal three plant groups without hiding urgent work", async () => {
  const h = await harness();
  const fern = h.data.plants[0];
  h.data.plants = Array.from({ length: 5 }, (_, index) => ({ ...fern, id: `guest-${index}`, name: `Fern ${index}` }));
  h.manual();
  assert.ok(h.render().some(node => node.props.children === "Fern 2"));
  assert.ok(!h.render().some(node => node.props.children === "Fern 3"));
  h.press("Show all manual checks");
  assert.ok(h.render().some(node => node.props.children === "Fern 4"));
});

test("sheets respect reduced motion and small screen widths", async () => {
  for (const reducedMotion of [false, true]) {
    const h = await harness(true, 320, reducedMotion);
    h.press("Filter care tasks: Pending · All dates");
    assert.equal(h.render().find(node => node.type === "Modal")!.props.animationType, reducedMotion ? "none" : "slide");
    h.press("Show Next Week tasks"); h.press("Apply task filters");
    assert.ok(!h.render().some(node => node.type === "Modal"));
    assert.ok(h.render().some(node => node.props.accessibilityLabel === "Filter care tasks: Pending · Next week"));
  }
});

test("real plant thumbnails remain, and scan checks navigate with plant context", async () => {
  const h = await harness(false); h.data.plants[0].imageUrl = "https://images.test/fern.jpg";
  h.data.plants[0].lastScannedAt = undefined;
  const thumbnail = h.render().find(node => node.type === "CareTaskThumbnail")!;
  assert.equal(thumbnail.props.uri, h.data.plants[0].imageUrl);
  h.details("Scan actual plant image"); h.press("Scan Fern");
  assert.deepEqual(JSON.parse(JSON.stringify(h.navigated)), [{ pathname: "/(tabs)/scanner", params: { plantId: "p1" } }]);
});

test("status views expose completion history without changing task sources", async () => {
  const h = await harness(); h.manual();
  h.press("Complete Check soil moisture for Fern"); await nextTurn();
  assert.ok(h.render().some(node => node.props.children === "0 due today · 1 pending"));
  h.completedView();
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Undo Check soil moisture for Fern"));
  assert.ok(!h.render().some(node => node.props.accessibilityLabel === "Complete Check light conditions for Fern"));
  h.filter("all"); h.manual();
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Undo Check soil moisture for Fern"));
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Complete Check light conditions for Fern"));
  assert.equal(h.accountWrites.length, 0);
});
