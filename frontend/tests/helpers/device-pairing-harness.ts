import type * as React from "react";
import type { Device, Plant } from "../../types";
import type { ConfirmedPairing } from "../../context/app-data";
import * as validators from "../../services/validators";
import * as deviceServices from "../../services/device-connection";
import { accountId, plantId, claimedDevice, hookHarness, loadProduction, elements, type Element } from "./device-flow-harness";

export const ownedPlant: Plant = { id: plantId, name: "Fern", species: "Fern", healthStatus: "healthy", createdAt: claimedDevice.createdAt, updatedAt: claimedDevice.updatedAt };
export const oldPlant: Plant = { ...ownedPlant, id: "55555555-5555-4555-8555-555555555555", name: "Old Fern", deviceId: claimedDevice.id };
export type PairingData = {
  guest: boolean; plants: Plant[]; loaded: boolean; loading: boolean; error: string | null;
  pendingDevice: Device | null; confirmedPairing: ConfirmedPairing | null;
  rememberClaimedDevice: (device: Device) => void;
  pairClaimedDevice: (plantId: string, signal?: AbortSignal) => Promise<ConfirmedPairing>;
  refresh: () => Promise<void>;
};
export function providerHarness(injected: {
  fetchUserPlants?: (options?: { signal?: AbortSignal }) => Promise<Plant[]>;
  pairDeviceToPlant?: (plantId: string, deviceId: string | null, options?: { signal?: AbortSignal }) => Promise<Plant>;
} = {}, guest = false) {
  const hooks = hookHarness();
  const auth = { status: guest ? "guest" : "authenticated", isGuest: guest, generation: 1, user: guest ? null : { id: accountId }, enterGuest() {}, leaveGuest() {} };
  let snapshot = { ...auth };
  const pairs: { plantId: string; deviceId: string | null; signal?: AbortSignal }[] = [];
  const behavior = {
    fetch: injected.fetchUserPlants ?? (async () => [ownedPlant, oldPlant]),
    pair: injected.pairDeviceToPlant ?? (async (id: string, deviceId: string | null) => ({ ...ownedPlant, id, deviceId: deviceId ?? undefined })),
  };
  const module = loadProduction("context/app-data.tsx", {
    react: hooks.hooks,
    "@/services/api": { fetchUserPlants: (options?: { signal?: AbortSignal }) => behavior.fetch(options), pairDeviceToPlant: (id: string, deviceId: string | null, options?: { signal?: AbortSignal }) => { pairs.push({ plantId: id, deviceId, signal: options?.signal }); return behavior.pair(id, deviceId, options); } },
    "@/services/validators": validators,
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "./auth": { useAuth: () => auth, session: { snapshot: () => snapshot } },
    "./local-state": { useLocalState: () => ({ data: { guestPlants: [] }, ready: true }) },
  });
  const outer = module.AppDataProvider as (props: object) => Element;
  const account = outer({}).type as unknown as (props: object) => Element;
  let value: PairingData;
  const render = () => { value = hooks.render(() => account({})).props.value as PairingData; return value; };
  render();
  return { render, pairs, behavior, get value() { return value; }, get writesAfterDispose() { return hooks.writesAfterDispose; },
    changeAccount() { snapshot = { ...auth, generation: 2, user: { id: "22222222-2222-4222-8222-222222222222" } }; },
    claim(device = claimedDevice) { value.rememberClaimedDevice(device); render(); },
    dispose: hooks.dispose,
    async settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); render(); } },
    async load() { await value.refresh(); render(); },
  };
}

export function assignmentHarness(readData: () => PairingData, screen = "assignment") {
  const hooks = hookHarness();
  let active = true;
  let params: Record<string, unknown> = { deviceId: claimedDevice.id, targetType: "plant", targetId: plantId };
  const navigations: unknown[] = [];
  const module = loadProduction(`app/device-connection/${screen}.tsx`, {
    react: hooks.hooks,
    "react-native": { FlatList: "FlatList", ScrollView: "ScrollView", Text: "Text", Pressable: "Pressable", View: "View" },
    "@/components/device-connection-screen": { DeviceConnectionScreen: "DeviceConnectionScreen", deviceStyles: {} },
    "@/components/screen": { Action: "Action", Notice: "Notice", ui: {} },
    "@/context/app-data": { useAppData: readData },
    "@/hooks/use-device-activity": { useDeviceActivity: () => active },
    "@/services/device-connection": deviceServices,
    "@expo/vector-icons": { Ionicons: "Icon" },
    "expo-router": { Redirect: "Redirect", useLocalSearchParams: () => params, useRouter: () => ({ replace: (route: unknown) => navigations.push(route), dismissTo: (route: unknown) => navigations.push(route) }) },
  });
  const component = module.default as () => Element;
  let tree: Element;
  const render = () => { tree = hooks.render(component); return tree; };
  const allElements = () => elements(tree).flatMap((node) => [node, ...elements(node.props.ListHeaderComponent as React.ReactNode), ...elements(node.props.ListFooterComponent as React.ReactNode)]);
  render();
  return { render, navigations, get tree() { return tree; }, get text() { return JSON.stringify(tree); },
    press(label = "Connect to selected destination") { const button = allElements().find((node) => (node.props.label === label || (label === "Connect to selected destination" && node.props.label === "Connecting…"))); if (!button) throw new Error(`Missing ${label}`); if (!button.props.disabled) (button.props.onPress as () => void)(); render(); },
    params(value: Record<string, unknown>) { params = value; render(); },
    blur() { active = false; render(); }, cancel() { (tree.props.onCancel as () => void)(); render(); },
    dispose: hooks.dispose,
    async settle() { for (let i = 0; i < 20; i++) { await Promise.resolve(); render(); } },
  };
}
