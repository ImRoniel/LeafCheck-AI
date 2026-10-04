import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { createScanFlow } from "../../services/scan-flow";
import * as errors from "../../services/errors";
import * as scanErrors from "../../services/scan-errors";
import type { Plant, ScanRequest, ScanResponse } from "../../types";
import type { PreScanResult } from "../../types/pre-scan-validation";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export const report: ScanResponse = {
  success: true, plant: { id: "flower", name: "Flower", species: "Rose" },
  identification: { speciesName: "Rose", commonName: "Rose", confidence: 1 },
  diagnostic: { id: "diagnosis", healthStatus: "healthy", rawAnalysisText: "Healthy flower", telemetryFreshness: "No sensor" },
  telemetry: null, careTasks: [], notification: null,
};
export const plant: Plant = { id: "flower", name: "Flower", species: "Rose", healthStatus: "healthy", createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z" };
export const picture = { uri: "memory:flower", base64: "synthetic-image" };
type Picture = { uri: string; base64?: string };
type Props = Record<string, unknown> & { children?: React.ReactNode };
export type Element = React.ReactElement<Props>;
type Effect = { deps?: readonly unknown[]; cleanup?: () => void };
const requireModule = createRequire(`${process.cwd()}/package.json`);

// A deterministic unit harness: real screen, viewfinder, hook and flow; mocked
// native/platform boundaries. This cannot establish physical camera behavior.
export function scannerHarness() {
  let cursor = 0;
  let dirty = true;
  let disposed = false;
  let pathname = "/scanner";
  let status = "authenticated";
  let params: { plantId?: string; deviceId?: string } = {};
  let permission = { granted: true, canAskAgain: true };
  const slots: unknown[] = [];
  const effects: (() => void)[] = [];
  const cleanups = new Map<number, () => void>();
  const setups = new Map<number, () => void | (() => void)>();
  const appListeners = new Set<(state: string) => void>();
  let root: Element;
  let preview: Element | undefined;
  let mounts = 0;
  let unmounts = 0;
  let writesAfterDispose = 0;
  let haptics = 0;
  let chimes = 0;
  let captures = 0;
  let validations = 0;
  let refreshes = 0;
  let canGoBack = true;
  const navigation: string[] = [];
  const requests: ScanRequest[] = [];
  const signals: AbortSignal[] = [];
  const validationSignals: AbortSignal[] = [];
  const behavior = {
    picture: async (): Promise<Picture> => picture,
    validate: async (_uri: string, _signal?: AbortSignal): Promise<PreScanResult> => ({ valid: true, reason: "ok", guidance: "" }),
    scan: async (_request: ScanRequest): Promise<ScanResponse> => report,
    update: async () => ({ id: "flower", healthStatus: "healthy" as const }),
    fetch: async (): Promise<Plant> => plant,
    permission: async () => permission,
  };
  const flow = createScanFlow({
    scanPlant: (request, options) => { requests.push(request); if (options?.signal) signals.push(options.signal); return behavior.scan(request); },
    updatePlantHealth: () => behavior.update(),
    fetchPlant: () => behavior.fetch(),
  });
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (value: unknown) => {
        if (disposed) { writesAfterDispose++; return; }
        const next = typeof value === "function" ? value(slots[i]) : value;
        if (!Object.is(slots[i], next)) { slots[i] = next; dirty = true; }
      }];
    },
    useRef(initial: unknown) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const i = cursor++;
      const old = slots[i] as { callback: unknown; deps: readonly unknown[] } | undefined;
      if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) slots[i] = { callback, deps };
      return (slots[i] as { callback: unknown }).callback;
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      const i = cursor++;
      const old = slots[i] as Effect | undefined;
      if (!old || !deps || deps.some((d, j) => !Object.is(d, old.deps?.[j]))) {
        const next: Effect = { deps };
        slots[i] = next;
        effects.push(() => {
          old?.cleanup?.();
          setups.set(i, effect);
          next.cleanup = effect() || undefined;
          if (next.cleanup) cleanups.set(i, next.cleanup); else cleanups.delete(i);
        });
      }
    },
    useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
      hooks.useEffect(effect, deps);
    },
    useSyncExternalStore(subscribe: (listener: () => void) => () => void, getState: () => unknown) {
      hooks.useEffect(() => subscribe(() => { dirty = true; }), [subscribe]);
      return getState();
    },
  };
  const app = {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appListeners.add(listener);
      return { remove: () => appListeners.delete(listener) };
    },
  };
  const router = {
    canGoBack: () => canGoBack,
    back: () => { navigation.push("back"); pathname = "/"; dirty = true; },
    replace: (path: string) => { navigation.push(path); pathname = path; dirty = true; },
    push: (path: string) => { navigation.push(path); pathname = path; dirty = true; },
  };
  const native = {
    AppState: app, Linking: { openSettings: () => behavior.permission() },
    View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView",
    Image: "Image", ActivityIndicator: "ActivityIndicator", RefreshControl: "RefreshControl",
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
  };
  const modules = new Map<string, unknown>();
  const refresh = async () => { refreshes++; };
  const load = (file: string): Record<string, unknown> => {
    if (modules.has(file)) return modules.get(file) as Record<string, unknown>;
    const exports: Record<string, unknown> = {};
    modules.set(file, exports);
    runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      exports, console, Error, Promise, AbortController,
      window: { AudioContext: class {
        currentTime = 0; destination = {};
        constructor() { chimes++; }
        createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
        createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      } },
      require(name: string): unknown {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return requireModule(name);
        if (name === "react-native") return native;
        if (name === "expo-router") return { useRouter: () => router, usePathname: () => pathname, useLocalSearchParams: () => params };
        if (name.endsWith("context/auth")) return { useAuth: () => ({ status }) };
        if (name.endsWith("context/app-data")) return { useAppData: () => ({ refresh }) };
        if (name.endsWith("services/scan-flow")) return { createScanFlow: () => flow };
        if (name.endsWith("services/errors")) return errors;
        if (name.endsWith("services/scan-errors")) return scanErrors;
        if (name.endsWith("services/pre-scan-validation")) return { validatePreScan: (uri: string, signal?: AbortSignal) => {
          validations++;
          if (signal) validationSignals.push(signal);
          return behavior.validate(uri, signal);
        } };
        if (name === "expo-camera") return { CameraView: "CameraView", useCameraPermissions: () => [permission, () => behavior.permission()] };
        if (name === "expo-haptics") return { NotificationFeedbackType: { Success: "success" }, notificationAsync: async () => { haptics++; } };
        if (name === "expo-status-bar") return { StatusBar: "StatusBar" };
        if (name === "@expo/vector-icons") return { Ionicons: "Ionicons" };
        if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
        if (name.endsWith("components/telemetry-history")) return { measurement: (value: unknown) => String(value) };
        if (name.startsWith("@/")) return load(`${name.slice(2)}.${name.includes("hooks/") ? "ts" : "tsx"}`);
        throw new Error(`Unexpected scanner import: ${name}`);
      },
    });
    return exports;
  };
  const component = load("app/(tabs)/scanner.tsx").default as () => Element;
  const nodes = (node: React.ReactNode): Element[] => {
    if (!React.isValidElement<Props>(node)) return [];
    if (typeof node.type === "function") return nodes((node.type as (props: Props) => React.ReactNode)(node.props));
    return [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
  };
  let rendered: Element[] = [];
  const render = () => {
    if (disposed) return;
    for (let pass = 0; dirty; pass++) {
      if (pass > 30) throw new Error("Scanner render did not settle");
      dirty = false; cursor = 0;
      root = component();
      rendered = nodes(root);
      const next = rendered.find((node) => node.type as unknown === "CameraView");
      const oldRef = preview?.props.ref as { current: unknown } | undefined;
      const newRef = next?.props.ref as { current: unknown } | undefined;
      if (preview && (!next || preview.key !== next.key)) { unmounts++; if (oldRef) oldRef.current = null; }
      if (next && (!preview || preview.key !== next.key)) mounts++;
      if (newRef) newRef.current = { takePictureAsync: () => { captures++; return behavior.picture(); } };
      preview = next;
      effects.splice(0).forEach((effect) => effect());
    }
  };
  const text = (node: React.ReactNode): string => React.isValidElement<Props>(node)
    ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" ? node : "";
  const findButton = (label: string) => rendered.find((node) =>
    (node.type as unknown) === "Pressable" && (node.props.accessibilityLabel === label || text(node) === label));
  render();
  return {
    behavior, flow, requests, signals, validationSignals, navigation,
    render,
    get root() { return root; },
    get preview() { return preview; },
    get stats() { return { mounts, unmounts, captures, validations, haptics, chimes, refreshes, writesAfterDispose }; },
    get text() { return rendered.filter((n) => (n.type as unknown) === "Text").map(text).join(" "); },
    get images() { return rendered.filter((n) => (n.type as unknown) === "Image"); },
    button: findButton,
    press(label: string) {
      const button = findButton(label);
      if (!button) throw new Error(`Missing button: ${label}`);
      if (!button.props.disabled) (button.props.onPress as () => void)();
      render();
    },
    ready() { (preview?.props.onCameraReady as (() => void) | undefined)?.(); render(); },
    route(path: string, targets: typeof params = {}) { pathname = path; params = targets; dirty = true; render(); },
    permission(granted: boolean, canAskAgain = true) { permission = { granted, canAskAgain }; dirty = true; render(); },
    auth(value: string) { status = value; dirty = true; render(); },
    canGoBack(value: boolean) { canGoBack = value; },
    replayEffects() {
      cleanups.forEach((cleanup) => cleanup()); cleanups.clear();
      setups.forEach((setup, i) => {
        const cleanup = setup() || undefined;
        (slots[i] as Effect).cleanup = cleanup;
        if (cleanup) cleanups.set(i, cleanup);
      });
      render();
    },
    background(value: string) { app.currentState = value; appListeners.forEach((fn) => fn(value)); render(); },
    async settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); render(); } },
    unmount() {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup()); cleanups.clear();
      if (preview) { unmounts++; (preview.props.ref as { current: unknown }).current = null; preview = undefined; }
    },
  };
}
