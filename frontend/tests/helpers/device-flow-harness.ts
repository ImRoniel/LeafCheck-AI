import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import type { Device } from "../../types";
import * as errors from "../../services/errors";
import { normalizeMac } from "../../services/validators";

export const frontendRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireModule = createRequire(import.meta.url);
export type ElementProps = Record<string, unknown> & { children?: React.ReactNode };
export type Element = React.ReactElement<ElementProps>;
export const accountId = "11111111-1111-4111-8111-111111111111";
export const plantId = "44444444-4444-4444-8444-444444444444";
export const claimedDevice: Device = {
  id: "33333333-3333-4333-8333-333333333333", name: "Leaf sensor", macAddress: "LC-A50528",
  userId: "11111111-1111-4111-8111-111111111111", status: "OFFLINE", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function hookHarness() {
  let cursor = 0;
  const slots: unknown[] = [];
  const effects = new Map<number, { deps?: readonly unknown[]; cleanup?: () => void }>();
  const pending: (() => void)[] = [];
  let disposed = false;
  let writesAfterDispose = 0;
  const effect = (setup: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = cursor++;
    const old = effects.get(index);
    if (old && deps && old.deps?.length === deps.length && deps.every((value, i) => Object.is(value, old.deps?.[i]))) return;
    pending.push(() => { old?.cleanup?.(); effects.set(index, { deps, cleanup: setup() || undefined }); });
  };
  const hooks = {
    ...React,
    createContext: () => ({ Provider: "Provider" }),
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: unknown) => {
        if (disposed) { writesAfterDispose++; return; }
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index] as { callback: unknown; deps: readonly unknown[] } | undefined;
      if (!previous || previous.deps.length !== deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i])))
        slots[index] = { callback, deps };
      return (slots[index] as { callback: unknown }).callback;
    },
    useEffect: effect, useLayoutEffect: effect,
  };
  return { hooks, render<T>(component: () => T): T { cursor = 0; const tree = component(); pending.splice(0).forEach((run) => run()); return tree; },
    dispose() { disposed = true; effects.forEach(({ cleanup }) => cleanup?.()); },
    get writesAfterDispose() { return writesAfterDispose; } };
}
export function loadProduction(file: string, modules: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(`${frontendRoot}${file}`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, AbortController, setTimeout, clearTimeout, console,
    require(name: string) {
      if (name === "react/jsx-runtime") return requireModule(name);
      if (name in modules) return modules[name];
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}
export function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement<ElementProps>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
export function claimHarness(injectedClaim?: (mac: string, name?: string, options?: { signal?: AbortSignal }) => Promise<Device>,
  config: { userId?: string; targetType?: string; targetId?: string; rememberClaimedDevice?: (device: Device) => void } = {}) {
  const hooks = hookHarness();
  let active = true;
  let auth = { status: "authenticated", generation: 1, user: { id: config.userId ?? accountId } };
  let snapshot = auth;
  let permission = { granted: true, canAskAgain: true };
  let pendingDevice: Device | null = null;
  const claims: string[] = [];
  const signals: AbortSignal[] = [];
  const navigations: unknown[] = [];
  const behavior = { claim: injectedClaim ?? (async () => claimedDevice), permission: async () => permission };
  const module = loadProduction("app/device-connection/scanner.tsx", {
    react: hooks.hooks,
    "react-native": { ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View" },
    "@/components/device-connection-screen": { DeviceConnectionScreen: "DeviceConnectionScreen", deviceStyles: {} },
    "@/components/screen": { Action: "Action", Notice: "Notice", ui: {} },
    "@/context/auth": { useAuth: () => auth, session: { snapshot: () => snapshot } },
    "@/context/app-data": { useAppData: () => ({ rememberClaimedDevice: (device: Device) => { config.rememberClaimedDevice?.(device); pendingDevice = device; } }) },
    "@/hooks/use-device-activity": { useDeviceActivity: () => active },
    "@/services/api": { claimDevice: (mac: string, name?: string, options?: { signal?: AbortSignal }) => {
      claims.push(mac); if (options?.signal) signals.push(options.signal); return behavior.claim(mac, name, options);
    } },
    "@/services/errors": errors,
    "@/services/validators": { normalizeMac },
    "expo-camera": { CameraView: "CameraView", useCameraPermissions: () => [permission, () => behavior.permission()] },
    "expo-router": { useLocalSearchParams: () => ({ targetType: config.targetType ?? "plant", targetId: config.targetId ?? plantId }), useRouter: () => ({ replace: (route: unknown) => navigations.push(route), push: (route: unknown) => navigations.push(route) }) },
  });
  const component = module.default as () => Element;
  let tree: Element;
  const render = () => { tree = hooks.render(component); return tree; };
  const find = (type: string, label?: string) => elements(tree).find((node) => node.type as unknown === type && (!label || node.props.label === label));
  render();
  return { claims, signals, navigations, behavior, render,
    get tree() { return tree; }, get pendingDevice() { return pendingDevice; },
    get text() { return JSON.stringify(tree); }, get writesAfterDispose() { return hooks.writesAfterDispose; },
    enter(value: string) { (find("TextInput")?.props.onChangeText as (value: string) => void)(value); render(); },
    press(label: string) { const button = find("Action", label); if (!button) throw new Error(`Missing ${label}`); if (!button.props.disabled) (button.props.onPress as () => void)(); render(); },
    scan(value: string) { (find("CameraView")?.props.onBarcodeScanned as ((event: { data: string }) => void) | undefined)?.({ data: value }); render(); },
    permission(granted: boolean, canAskAgain = false) { permission = { granted, canAskAgain }; render(); },
    blur() { active = false; render(); }, cancel() { (tree.props.onCancel as () => void)(); render(); },
    auth(status: string, generation = 2) { auth = { ...auth, status, generation }; snapshot = auth; pendingDevice = null; render(); },
    snapshotOnly() { snapshot = { ...auth, generation: auth.generation + 1, user: { id: "22222222-2222-4222-8222-222222222222" } }; },
    dispose: hooks.dispose,
    async settle() { for (let i = 0; i < 15; i++) { await Promise.resolve(); render(); } },
  };
}
