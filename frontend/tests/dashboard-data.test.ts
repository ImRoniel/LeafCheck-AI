import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { loadDashboardTelemetry } from "../services/dashboard-telemetry";
import * as summaryService from "../services/dashboard-summary";
import { sensorOverviewErrorMessage } from "../services/sensor-overview";
import * as careTasks from "../services/care-tasks";
import type { Plant } from "../types/plant";
import type { PlantTelemetry } from "../types/device";
import type { useDashboardData } from "../hooks/use-dashboard-data";

const now = new Date().toISOString();
const plant: Plant = { id: "p1", deviceId: "device-id", name: "Fern", species: "Fern", healthStatus: "unknown", lastScannedAt: now, createdAt: now, updatedAt: now };
const payload: PlantTelemetry = { paired: true, device: { id: "device-id", macAddress: "LC-A50528", userId: "owner", name: "Window", status: "ONLINE", createdAt: now, updatedAt: now }, telemetry: {
  deviceId: "device-id", timestamp: now, environment: { temperatureCelsius: 24, humidityPercentage: 60 }, soilMoisture: { percentage: null, rawAnalogValue: 3000, status: "unavailable" }, lightLevel: { lux: 1000, status: "optimal" },
} };

test("telemetry requests use owned plant IDs, bound concurrent work and isolate individual failures", async () => {
  const plants: Plant[] = Array.from({ length: 9 }, (_, index) => ({ ...plant, id: `p${index}` }));
  plants.push({ ...plant, id: "unpaired", deviceId: undefined });
  let current = 0; let peak = 0;
  const ids: string[] = [];
  const signal = new AbortController().signal;
  const samples = await loadDashboardTelemetry(plants, signal, async (id, passed) => {
    assert.equal(passed, signal); ids.push(id); peak = Math.max(peak, ++current);
    await new Promise(resolve => setTimeout(resolve, 1)); --current;
    if (id === "p3") throw new Error("private diagnostics");
    return payload;
  });
  assert.equal(peak, 4); assert.equal(samples.length, 9); assert.ok(!ids.includes("unpaired"));
  assert.deepEqual(samples.find(item => item.plantId === "p3"), { plantId: "p3", payload: null, failed: true });
  assert.equal(samples.find(item => item.plantId === "p4")?.payload, payload);
});
test("cancellation stops further batches and prevents publishing a partial snapshot", async () => {
  const abort = new AbortController(); let calls = 0;
  const plants = Array.from({ length: 8 }, (_, index) => ({ ...plant, id: `p${index}` }));
  await assert.rejects(loadDashboardTelemetry(plants, abort.signal, async () => { ++calls; abort.abort(); return payload; }), { name: "AbortError" });
  assert.equal(calls, 4);
});

function harness() {
  const requireModule = createRequire(`${process.cwd()}/package.json`);
  const data = { plants: [plant], loaded: true, loading: false, guest: false, error: null, refresh: async () => {} };
  const auth = { generation: 1 };
  let active = true;
  const snapshots = new Map<string, unknown>();
  const requests: { key: string; load: (signal: AbortSignal) => Promise<unknown>; enabled: boolean }[] = [];
  const fetched: string[] = [];
  const exports: { useDashboardData?: typeof useDashboardData } = {};
  runInNewContext(ts.transpileModule(readFileSync("hooks/use-dashboard-data.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, setTimeout, clearTimeout, setInterval, clearInterval,
    require(name: string) {
      if (name === "react") return { useEffect: () => {}, useState: (initial: () => unknown) => [initial(), () => {}] };
      if (name === "@/context/auth") return { useAuth: () => auth };
      if (name === "@/context/app-data") return { useAppData: () => data };
      if (name === "@/context/local-state") return { useLocalState: () => ({ ready: true, error: null, data: { schedules: {}, careCompletions: [], connectedDevices: [{ source: "mock" }] } }) };
      if (name === "./use-device-activity") return { useDeviceActivity: () => active };
      if (name === "@/services/dashboard-summary") return summaryService;
      if (name === "@/services/dashboard-telemetry") return { loadDashboardTelemetry };
      if (name === "@/services/care-tasks") return careTasks;
      if (name === "@/services/api") return { api: { fetchPlantTelemetry: async (id: string) => { fetched.push(id); return payload; }, fetchTasks: async () => [], fetchArchives: async () => [] } };
      if (name === "@/services/use-polling-resource") return { usePollingResource: (key: string, load: (signal: AbortSignal) => Promise<unknown>, options: { enabled: boolean }) => {
        requests.push({ key, load, enabled: options.enabled });
        return { data: snapshots.get(key) ?? null, loading: false, error: null, refresh: async () => {} };
      } };
      return requireModule(name);
    },
  });
  const render = () => { requests.length = 0; return exports.useDashboardData!(); };
  return { data, auth, snapshots, requests, fetched, render, active: (value: boolean) => { active = value; } };
}
test("dashboard hook reads server telemetry despite local mock assignments and fences account/plant changes", async () => {
  const h = harness();
  assert.equal(h.render().sensors[0].status, "checking");
  const request = h.requests[0];
  h.snapshots.set(request.key, await request.load(new AbortController().signal));
  assert.equal(h.render().sensors[0].status, "receiving");
  assert.equal(h.render().sensors[0].address, "LC-A50528");
  assert.deepEqual(h.fetched, [plant.id]);
  h.auth.generation++;
  assert.equal(h.render().sensors[0].status, "checking");
  h.data.plants = [{ ...plant, deviceId: "replacement" }];
  assert.equal(h.render().sensors[0].status, "checking");
  assert.ok(h.requests[0].key.includes("replacement"));
});
test("guest/blur disable all dashboard polling; old account samples never enter a guest digest", async () => {
  const h = harness(); h.render();
  const request = h.requests[0]; h.snapshots.set(request.key, await request.load(new AbortController().signal));
  h.active(false); h.render();
  assert.ok(h.requests.every(item => !item.enabled));
  h.data.guest = true;
  assert.equal(h.render().sensors.length, 0);
  assert.equal(h.render().scansReady, false);
  assert.equal(h.render().careReady, true);
  assert.ok(h.requests.every(item => !item.enabled));
});

test("sensor overview polling passes cancellation signals and fences stale account inventory", async () => {
  const auth = { generation: 1, status: "authenticated" };
  let active = true;
  let snapshot: { key: string; entries: unknown[] } | null = null;
  let requestedKey = "";
  let enabled = false;
  let load!: (signal: AbortSignal) => Promise<{ key: string; entries: unknown[] }>;
  let passedSignal: AbortSignal | undefined;
  const exports: { useSensorOverview?: () => { entries: unknown[]; ready: boolean } } = {};
  runInNewContext(ts.transpileModule(readFileSync("hooks/use-sensor-overview.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require(name: string) {
      if (name === "@/context/auth") return { useAuth: () => auth };
      if (name === "./use-device-activity") return { useDeviceActivity: () => active };
      if (name === "@/services/sensor-overview") return { sensorOverviewErrorMessage };
      if (name === "@/services/api") return { api: { fetchSensorOverview: async ({ signal }: { signal: AbortSignal }) => { passedSignal = signal; return [{ deviceId: "owned" }]; } } };
      if (name === "@/services/use-polling-resource") return { usePollingResource: (key: string, loader: typeof load, options: { enabled: boolean }) => {
        requestedKey = key; load = loader; enabled = options.enabled;
        return { data: snapshot, loading: false, error: null, refresh: async () => {} };
      } };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  assert.equal(exports.useSensorOverview!().ready, false); assert.ok(enabled);
  const signal = new AbortController().signal;
  snapshot = await load(signal); assert.equal(passedSignal, signal);
  assert.equal(exports.useSensorOverview!().entries.length, 1);
  auth.generation++;
  assert.equal(exports.useSensorOverview!().entries.length, 0);
  active = false; exports.useSensorOverview!(); assert.equal(enabled, false); assert.equal(requestedKey, "");
  active = true; auth.status = "guest";
  assert.equal(exports.useSensorOverview!().entries.length, 0); assert.equal(enabled, false);
});
