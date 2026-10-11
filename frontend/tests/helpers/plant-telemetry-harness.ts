import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { diagnosisPresentation } from "../../services/plant-profile-guidance";
import type { Plant, PlantTelemetry, ArchiveEntry, ScanRequest, ScanResponse } from "../../types";

const requireModule = createRequire(import.meta.url);
type ElementProps = { children?: React.ReactNode; label?: string; onPress?: () => void; value?: number; deviceId?: string; [key: string]: unknown };
export function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<ElementProps>(child) ? [child, ...elements(child.props.children)] : []);
}
export function press(node: React.ReactNode, label: string) {
  const found = elements(node).find((child) => child.props.label === label);
  if (!found) throw new Error(`Missing action: ${label}`);
  found.props.onPress?.();
}
export const plantId = "11111111-1111-4111-8111-111111111111";
export const accountId = "33333333-3333-4333-8333-333333333333";
export const testPlant: Plant = { id: plantId, name: "Fern", species: "Fern species", healthStatus: "healthy", createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" };
export function profileHarness(fetchPlantTelemetry: (id: string, options: { signal: AbortSignal }) => Promise<PlantTelemetry>, appDataSource?: () => { plants: Plant[]; loaded: boolean; loading: boolean; error: string | null; refresh: () => Promise<void> }) {
  let id: unknown = plantId;
  let auth = { generation: 1, status: "authenticated" };
  let appData = { plants: [testPlant], loaded: true, loading: false, error: null as string | null, devices: { [plantId]: "local-demo" } };
  let collectionReads = 0;
  const navigations: unknown[] = [];
  let savedGuidance: ArchiveEntry | null = null;
  let scanHandler: (request: ScanRequest, options?: { signal?: AbortSignal }) => Promise<ScanResponse> = async () => { throw new Error("Unexpected scan"); };
  let guidanceRefreshes = 0;
  const profileSlots: unknown[] = [];
  let slots = profileSlots;
  const callbacks = new Map<number, { deps: unknown[]; value: unknown }>();
  let cursor = 0;
  let focus: (() => void | (() => void)) | undefined;
  let cleanup: (() => void) | undefined;
  const hooks = {
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      const state = slots;
      return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? (value as (previous: unknown) => unknown)(state[index]) : value; }];
    },
    useCallback(value: unknown, deps: unknown[]) {
      const index = cursor++;
      const prior = callbacks.get(index);
      if (prior && deps.length === prior.deps.length && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.value;
      callbacks.set(index, { deps, value });
      return value;
    },
  };
  function load(path: string, overrides: Record<string, unknown> = {}) {
    const exports: Record<string, (props: never) => React.ReactElement<ElementProps>> = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      exports, AbortController,
      require(name: string) {
        if (name in overrides) return overrides[name];
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return requireModule(name);
        if (name === "react-native") return { Text: "Text", View: "View", Image: "Image", ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", StyleSheet: { create: (value: unknown) => value } };
        if (name === "@/components/screen" || name === "./screen") return { Screen: "Screen", Action: "Action", Notice: "Notice", ui: {} };
        if (name === "@/context/app-data") return { useAppData: () => appDataSource?.() ?? ({ ...appData, refresh: async () => { collectionReads++; } }) };
        if (name === "@/context/auth") return { useAuth: () => auth };
        if (name === "@/hooks/use-plant-profile-guidance") return { usePlantProfileGuidance: () => ({ data: { latest: savedGuidance, pending: [] }, loading: false, error: null, refresh: async () => { guidanceRefreshes++; } }) };
        if (name === "@/services/plant-profile-guidance") return { diagnosisPresentation };
        if (name === "./DiagnosticReport") return { DiagnosticReport: "DiagnosticReport" };
        for (const component of ["PlantProfileHeader", "PlantDiagnosisCard", "PlantCareTasksCard"]) {
          if (name.endsWith(component)) return { [component]: component };
        }
        if (name === "@/services/api") return { fetchPlantTelemetry, scanPlant: (request: ScanRequest, options?: { signal?: AbortSignal }) => scanHandler(request, options) };
        if (name === "@expo/vector-icons") return { Ionicons: "Icon" };
        if (name === "expo-router") return { useLocalSearchParams: () => ({ id }), useRouter: () => ({ push: (route: unknown) => navigations.push(route) }), useFocusEffect: (callback: () => void | (() => void)) => { if (callback !== focus) { cleanup?.(); focus = callback; cleanup = callback() || undefined; } } };
        if (name === "./metric-card") return { MetricCard: "MetricCard" };
        if (name === "./telemetry-history") return { TelemetryHistory: "TelemetryHistory" };
        if (name.endsWith("plant-care-summary")) return { PlantCareSummary: "PlantCareSummary" };
        if (name.endsWith("edit-plant-form")) return { EditPlantForm: "EditPlantForm" };
        if (name.endsWith("delete-plant-action")) return { DeletePlantAction: "DeletePlantAction" };
        throw new Error(`Unexpected production import: ${name}`);
      },
    });
    return exports;
  }
  const telemetry = load("components/plant-telemetry.tsx").PlantTelemetry;
  const profile = load("app/plant-profile.tsx", { "@/components/plant-telemetry": { PlantTelemetry: "PlantTelemetry" } }).default;
  const telemetrySlots: unknown[] = [];
  const childSlots = new Map<string, unknown[]>();
  const children = Object.fromEntries(["PlantProfileHeader", "PlantDiagnosisCard", "PlantCareTasksCard"].map(name => [name, load(`components/${name}.tsx`)[name]]));
  function expand(node: React.ReactNode): React.ReactNode {
    return React.Children.map(node, child => {
      if (!React.isValidElement<ElementProps>(child)) return child;
      const name = String(child.type);
      if (name in children) {
        const key = `${name}:${child.key}`;
        if (!childSlots.has(key)) childSlots.set(key, []);
        slots = childSlots.get(key)!; cursor = 0;
        const rendered = children[name](child.props as never);
        slots = profileSlots;
        return React.cloneElement(child, {}, rendered);
      }
      return React.cloneElement(child, {}, expand(child.props.children));
    });
  }
  return {
    navigations, collectionReads: () => collectionReads,
    guidance: (latest: ArchiveEntry | null) => { savedGuidance = latest; },
    scan: (handler: typeof scanHandler) => { scanHandler = handler; },
    guidanceRefreshes: () => guidanceRefreshes,
    metadata: (value: Partial<typeof appData>) => { appData = { ...appData, ...value }; },
    target: (value: unknown) => { id = value; },
    session: (generation: number, status = "authenticated") => { auth = { generation, status }; },
    refocus: () => { cleanup?.(); cleanup = focus?.() || undefined; },
    dispose: () => cleanup?.(),
    render() {
      slots = profileSlots; cursor = 0;
      return expand(profile({} as never));
    },
    renderTelemetry(node: React.ReactNode) {
      const component = elements(node).find((child) => child.type === "PlantTelemetry");
      if (!component) throw new Error("No production telemetry component");
      // Separate component state, as React does for each mounted component.
      slots = telemetrySlots; cursor = 0;
      const result = telemetry(component.props as never);
      slots = profileSlots;
      return result;
    },
  };
}
