import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import { createApiClient } from "../services/api";
import { asApiError } from "../services/errors";
import * as dashboardSummary from "../services/dashboard-summary";
import * as sensorSummary from "../services/sensor-overview";
import type { SensorOverviewEntry } from "../types/device";
import { available, rootRoute } from "./startup-test-helpers";

const requireModule = createRequire(import.meta.url);
type Props = Record<string, unknown> & { children?: React.ReactNode };
type Element = React.ReactElement<Props>;
const plantId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const now = new Date().toISOString();
const device = { id: deviceId, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Window sensor", macAddress: "LC-A50528", status: "ONLINE" as const, createdAt: now, updatedAt: now };
const inventory: SensorOverviewEntry[] = [
  { device, plants: [{ id: plantId, name: "Fern" }], demo: false, readingError: false, telemetry: null },
  { device: { ...device, id: "33333333-3333-4333-8333-333333333333", name: "Spare sensor", macAddress: "LC-000001" }, plants: [], demo: false, readingError: false, telemetry: null },
  { device: { ...device, id: "44444444-4444-4444-8444-444444444444", name: "Demo sensor", macAddress: "DEMO:44444444-4444-4444-8444-444444444444", status: "SIMULATED" },
    plants: [{ id: "55555555-5555-4555-8555-555555555555", name: "Rose" }], demo: true, readingError: false, telemetry: null },
];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function text(node: React.ReactNode): string {
  return React.isValidElement<Props>(node) ? React.Children.toArray(node.props.children).map(text).join(" ")
    : typeof node === "string" || typeof node === "number" ? String(node) : "";
}

function harness(file: string, guest = false, exportName = "default") {
  let cursor = 0, dirty = true, disposed = false, writesAfterDispose = 0;
  const slots: unknown[] = [];
  const effects = new Map<number, { deps: readonly unknown[]; cleanup?: () => void }>();
  const pending: (() => void)[] = [];
  let active = true, writeFailure = false, refreshFailure = false, gate: ReturnType<typeof deferred> | undefined;
  let serverEntries = structuredClone(inventory);
  const routes: unknown[] = [], requests: { url: string; method: string; body?: unknown; signal?: AbortSignal | null }[] = [];
  let plantRefreshes = 0, logouts = 0;
  const auth = { status: guest ? "guest" : "authenticated", isGuest: guest, isLocal: guest, generation: 1,
    logout: async () => { logouts++; }, leaveLocal: () => {}, error: null };
  const overview = {
    entries: structuredClone(inventory), ready: true, loading: false,
    error: null as ReturnType<typeof asApiError> | null, errorMessage: null as string | null,
    async refresh() {
      overview.loading = true; dirty = true;
      try { overview.entries = await api.fetchSensorOverview(); overview.ready = true; overview.error = null; overview.errorMessage = null; dirty = true; }
      catch (error) { overview.error = asApiError(error); overview.errorMessage = "Couldn’t refresh your sensors."; dirty = true; throw error; }
      finally { overview.loading = false; dirty = true; }
    },
  };
  const api = createApiClient({ baseUrl: "https://settings.test", fetch: async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal });
    if (init?.method === "PATCH") {
      await gate?.promise;
      if (writeFailure) return Response.json({ error: "Sensor update unavailable" }, { status: 503 });
      serverEntries = serverEntries.map(entry => ({ ...entry, plants: entry.plants.filter(plant => plant.id !== plantId) }));
      return Response.json({ id: plantId, name: "Fern", species: "Fern", healthStatus: "healthy", createdAt: now, updatedAt: now });
    }
    if (refreshFailure) return Response.json({ error: "Inventory unavailable" }, { status: 503 });
    return Response.json(serverEntries);
  } });
  const hooks = { ...React,
    useState(initial: unknown) {
      const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], (next: unknown) => {
        if (disposed) { writesAfterDispose++; return; }
        const value = typeof next === "function" ? next(slots[i]) : next;
        if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; }
      }];
    },
    useRef(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(run: () => void | (() => void), deps: readonly unknown[] = []) {
      const i = cursor++, old = effects.get(i);
      if (old && deps.length === old.deps.length && deps.every((value, j) => Object.is(value, old.deps[j]))) return;
      pending.push(() => { old?.cleanup?.(); effects.set(i, { deps, cleanup: run() || undefined }); });
    },
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(path: string): Record<string, unknown> {
    const cached = cache.get(path); if (cached) return cached;
    const exports: Record<string, unknown> = {}; cache.set(path, exports);
    runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      exports, AbortController, setTimeout, clearTimeout, require(name: string) {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return requireModule(name);
        if (name === "react-native") return { View: "View", Text: "Text", Image: "Image", ScrollView: "ScrollView", Pressable: "Pressable", TextInput: "TextInput",
          Modal: "Modal", KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "web" }, StyleSheet: { create: (styles: unknown) => styles } };
        if (name === "@expo/vector-icons") return { Ionicons: "Icon" };
        if (name === "expo-router") return { useRouter: () => ({ push: (route: unknown) => routes.push(route), replace: (route: unknown) => routes.push(route), canGoBack: () => false }) };
        if (name === "expo-constants") return { __esModule: true, default: { expoConfig: { version: "1.0.0" } } };
        if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
        if (name === "@/components/screen") return { Screen: "Screen", Action: "Action", Notice: "Notice", ui: {} };
        if (name === "@/components/profile-photo-crop") return { ProfilePhotoCrop: "Crop" };
        if (name === "@/services/profile-photo-native") return { pickProfilePhoto: async () => null };
        if (name === "@/components/DashboardSensorStatusSheet") return { DashboardSensorStatusSheet: "SensorOverview" };
        if (name === "@/context/auth") return { useAuth: () => auth };
        if (name === "@/context/profile") return { useProfile: () => ({ name: "Roniel", email: guest ? undefined : "roniel@example.test", setName: async () => {} }) };
        if (name === "@/context/app-data") return { useAppData: () => ({ refresh: async () => { plantRefreshes++; } }) };
        if (name === "@/hooks/use-sensor-overview") return { useSensorOverview: () => overview };
        if (name === "@/hooks/use-device-activity") return { useDeviceActivity: () => active };
        if (name === "@/services/api") return { api };
        if (name === "@/services/dashboard-summary") return dashboardSummary;
        if (name === "@/services/sensor-overview") return sensorSummary;
        if (name === "./animated-pressable" || name === "@/components/animated-pressable") return { AnimatedPressable: "Pressable" };
        if (name.startsWith("@/components/")) return load(`components/${name.slice("@/components/".length)}.tsx`);
        if (name.startsWith("./")) return load(`components/${name.slice(2)}.tsx`);
        throw new Error(`Unexpected settings import ${name}`);
      },
    });
    return exports;
  }
  const component = load(file)[exportName] as (props: Record<string, unknown>) => React.ReactNode;
  let rendered: Element[] = [];
  function expand(node: React.ReactNode): Element[] {
    return React.Children.toArray(node).flatMap(child => !React.isValidElement<Props>(child) ? []
      : typeof child.type === "function" ? expand((child.type as (props: Props) => React.ReactNode)(child.props))
      : [child, ...expand(child.props.children)]);
  }
  const render = () => {
    if (disposed) return rendered;
    for (let pass = 0; dirty; pass++) {
      assert.ok(pass < 40, "Settings render should settle"); dirty = false; cursor = 0;
      rendered = expand(component({ plantCount: 11, ready: true, now: new Date() })); pending.splice(0).forEach(run => run());
    }
    return rendered;
  };
  const button = (label: string) => render().find(node => node.props.accessibilityLabel === label || node.props.label === label);
  render();
  return { auth, overview, requests, routes, button, render,
    get text() { return render().filter(node => node.type === "Text" || node.type === "Notice").map(text).join(" "); },
    get stats() { return { plantRefreshes, logouts, writesAfterDispose }; },
    press(label: string) { const control = button(label); assert.ok(control, label); if (!control.props.disabled) (control.props.onPress as () => void)(); dirty = true; render(); },
    failWrite(value: boolean) { writeFailure = value; }, failRefresh(value: boolean) { refreshFailure = value; },
    blockWrite() { gate = deferred(); return gate; },
    activity(value: boolean) { active = value; dirty = true; render(); },
    signOut() { auth.status = "signedOut"; auth.generation++; dirty = true; render(); },
    async settle() { for (let i = 0; i < 10; i++) { await nextTurn(); render(); } await delay(1); render(); },
    dispose() { disposed = true; effects.forEach(effect => effect.cleanup?.()); },
  };
}

test("Profile omits placeholder account rows while retaining account email, sign out and terms", async t => {
  const h = harness("app/profile.tsx"); t.after(h.dispose);
  assert.match(h.text, /roniel@example.test/);
  assert.doesNotMatch(h.text, /ACCOUNT|[Cc]oming soon|not available yet|Password|Avatar sync|Account deletion|Sign out everywhere/);
  for (const label of ["Device settings", "Edit Email", "Edit Password", "Email", "Password", "Avatar sync", "Account deletion", "Sign out everywhere"]) {
    assert.equal(h.button(label), undefined);
  }
  assert.ok(h.render().some(node => node.props.accessibilityLabel === "Edit profile name"));
  h.press("Terms and limitations"); assert.deepEqual(h.routes, ["/terms"]);
  h.press("Sign out"); await h.settle(); assert.equal(h.stats.logouts, 1);
});

test("Dashboard header exposes only the profile avatar and no Settings control", t => {
  const h = harness("components/greeting-header.tsx", false, "GreetingHeader"); t.after(h.dispose);
  assert.equal(h.button("Open settings"), undefined);
  assert.equal(h.render().filter(node => node.props.accessibilityRole === "button").length, 1);
  h.press("Open profile");
  assert.deepEqual(h.routes, ["/profile"]);
});

test("Profile header retains Back and its gear opens Settings for both account and guest sessions", t => {
  for (const guest of [false, true]) {
    const h = harness("app/profile.tsx", guest); t.after(h.dispose);
    assert.ok(h.button("Back"));
    const gear = h.button("Open settings"); assert.ok(gear);
    assert.equal(gear.props.accessibilityRole, "button");
    assert.ok(React.Children.toArray(gear.props.children).some(child => React.isValidElement<Props>(child) && child.props.name === "settings-outline"));
    h.press("Open settings");
    assert.deepEqual(h.routes, ["/settings"]);
  }
});

test("Settings routes working rows and sensor modal actions without roadmap placeholders", t => {
  const h = harness("app/settings.tsx"); t.after(h.dispose);
  assert.doesNotMatch(h.text, /[Cc]oming soon|not available yet/);
  for (const label of ["Notifications", "Appearance", "Temperature units", "Help & Support", "Privacy policy"]) {
    assert.ok(!h.text.includes(label)); assert.equal(h.button(label), undefined);
  }
  assert.match(h.text, /About LeafCheck AI/); assert.equal(h.button("About LeafCheck AI"), undefined);
  assert.match(h.text, /Version 1.0.0/); assert.doesNotMatch(h.text, /Save local mapping|Plant ID:/);
  h.press("Pair a new sensor"); h.press("AI & sensor limitations");
  assert.deepEqual(h.routes, ["/device-connection/scanner", "/terms"]);
  h.press("Connected sensors");
  const modal = h.render().find(node => node.type === "SensorOverview"); assert.ok(modal);
  (modal.props.onManageDevices as () => void)(); h.render();
  assert.equal(h.routes.at(-1), "/device-connection/manage"); assert.ok(!h.render().some(node => node.type === "SensorOverview"));
  h.press("Connected sensors");
  (h.render().find(node => node.type === "SensorOverview")!.props.onOpenPlant as (id: string) => void)(plantId); h.render();
  assert.deepEqual(JSON.parse(JSON.stringify(h.routes.at(-1))), { pathname: "/plant-profile", params: { id: plantId } });
});

test("guests see only Legal/About, and losing authentication hides an already-open sensor modal", t => {
  const guest = harness("app/settings.tsx", true); t.after(guest.dispose);
  assert.match(guest.text, /LEGAL/); assert.match(guest.text, /ABOUT/);
  assert.doesNotMatch(guest.text, /SENSORS|Coming soon|Notifications|Privacy policy/);
  assert.equal(guest.button("Connected sensors"), undefined); assert.equal(guest.button("Pair a new sensor"), undefined);
  assert.equal(guest.requests.length, 0);
  const account = harness("app/settings.tsx"); t.after(account.dispose);
  account.press("Connected sensors"); account.signOut();
  assert.ok(!account.render().some(node => node.type === "SensorOverview"));
});

test("root stack admits guest Settings while preserving account-only routes", () => {
  const guest = available(rootRoute({ status: "guest", isGuest: true }).route);
  assert.ok(guest.includes("settings"));
  for (const name of ["plant-profile", "archives", "device-connection"]) assert.ok(!guest.includes(name));
  assert.ok(available(rootRoute({ status: "authenticated" }).route).includes("settings"));
  assert.ok(!available(rootRoute({ status: "signedOut" }).route).includes("settings"));
});

test("device manager reads the account inventory including unlinked and demo devices", async t => {
  const h = harness("app/device-connection/manage.tsx"); t.after(h.dispose);
  await h.overview.refresh(); await h.settle();
  assert.equal(h.requests[0].url, "https://settings.test/api/devices/overview");
  for (const value of ["LC-A50528", "LC-000001", "DEMO:44444444", "Not linked to a plant", "Demo sensor"]) assert.match(h.text, new RegExp(value));
  assert.doesNotMatch(h.text, /Local demo assignments|Save local mapping/);
  h.press("Pair a new sensor"); assert.deepEqual(h.routes, ["/device-connection/scanner"]);
});

test("unlink calls the real API once, refreshes both collections and retains the owned device", async t => {
  const h = harness("app/device-connection/manage.tsx"); t.after(h.dispose);
  const pending = h.blockWrite(), label = "Unlink LC-A50528 from Fern";
  h.press(label); h.press(label);
  assert.match(h.text, /Unlinking/); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, `https://settings.test/api/plants/${plantId}/pair-device`);
  assert.equal(h.requests[0].method, "PATCH"); assert.deepEqual(h.requests[0].body, { deviceId: null });
  pending.resolve(); await h.settle();
  assert.match(h.text, /Sensor unlinked from Fern/); assert.equal(h.button(label), undefined);
  assert.equal(h.overview.entries.length, 3); assert.equal(h.overview.entries[0].plants.length, 0);
  assert.equal(h.overview.entries[2].plants[0].name, "Rose"); assert.equal(h.stats.plantRefreshes, 1);
});

test("failed unlink retains the pairing and permits recovery after refreshing", async t => {
  const h = harness("app/device-connection/manage.tsx"); t.after(h.dispose);
  const label = "Unlink LC-A50528 from Fern";
  h.failWrite(true); h.press(label); await h.settle();
  assert.match(h.text, /Could not confirm unlinking/); assert.equal(h.overview.entries[0].plants.length, 1);
  assert.ok(h.button(label)); assert.doesNotMatch(h.text, /Sensor unlinked from Fern/);
  h.failWrite(false); h.press("Refresh sensors"); await h.settle(); h.press(label); await h.settle();
  assert.equal(h.button(label), undefined); assert.equal(h.stats.plantRefreshes, 2);
});

test("an acknowledged unlink remains visible when inventory refresh fails, then refresh recovers", async t => {
  const h = harness("app/device-connection/manage.tsx"); t.after(h.dispose);
  h.failRefresh(true); h.press("Unlink LC-A50528 from Fern"); await h.settle();
  assert.match(h.text, /Sensor unlinked from Fern/); assert.match(h.text, /Couldn’t refresh the inventory/);
  assert.equal(h.button("Unlink LC-A50528 from Fern"), undefined);
  assert.equal(h.overview.entries[0].plants.length, 1); // The cached API snapshot still has the old link.
  h.failRefresh(false); h.press("Refresh sensors"); await h.settle();
  assert.equal(h.overview.entries[0].plants.length, 0); assert.equal(h.overview.error, null);
  assert.doesNotMatch(h.text, /Couldn’t refresh the inventory/);
});

for (const boundary of ["blur", "signout", "unmount"] as const) test(`pending unlink is cancelled on ${boundary} and late responses cannot publish success`, async t => {
  const h = harness("app/device-connection/manage.tsx"); t.after(h.dispose);
  const pending = h.blockWrite(); h.press("Unlink LC-A50528 from Fern");
  if (boundary === "blur") h.activity(false);
  if (boundary === "signout") h.signOut();
  if (boundary === "unmount") h.dispose();
  assert.equal(h.requests[0].signal?.aborted, true);
  pending.resolve(); await h.settle();
  assert.equal(h.stats.plantRefreshes, 0); assert.equal(h.stats.writesAfterDispose, 0);
  assert.doesNotMatch(h.text, /Sensor unlinked from Fern/);
});
