import type {
    DeviceTarget,
    MockDeviceConnection,
} from "../types/device-connection";
import type { Plant } from "../types/plant";

export const mockHardwareNodes = [
  {
    id: "mock-leaf-node-01",
    name: "Leaf Node 01",
    detail: "Soil moisture · Temperature · Humidity",
  },
  {
    id: "mock-leaf-node-02",
    name: "Leaf Node 02",
    detail: "Soil moisture · Temperature · Humidity",
  },
  {
    id: "mock-greenhouse-03",
    name: "Greenhouse Node 03",
    detail: "Temperature · Humidity · Light",
  },
] as const;

export function findMockDevice(id: unknown) {
  return mockHardwareNodes.find((node) => node.id === id);
}

export function deviceTargets(
  spaces: readonly string[],
  plants: readonly Plant[],
): DeviceTarget[] {
  return [
    ...spaces.map((name): DeviceTarget => ({ kind: "space", id: name, name })),
    ...plants.map(
      (plant): DeviceTarget => ({
        kind: "plant",
        id: plant.id,
        name: plant.name,
      }),
    ),
  ];
}

export function createMockConnection(
  deviceId: string,
  target: DeviceTarget,
  targets: readonly DeviceTarget[],
): MockDeviceConnection {
  if (!findMockDevice(deviceId))
    throw new Error("Choose a discovered demo device.");
  const current = targets.find(
    (item) => item.kind === target.kind && item.id === target.id,
  );
  if (!current)
    throw new Error(
      "That assignment is no longer available. Choose another Space or Plant.",
    );
  return {
    source: "mock",
    deviceId,
    target: { ...current },
    connectedAt: new Date().toISOString(),
  };
}

export function isMockDeviceConnection(
  value: unknown,
): value is MockDeviceConnection {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MockDeviceConnection>;
  const target = item.target;
  return (
    item.source === "mock" &&
    !!findMockDevice(item.deviceId) &&
    typeof item.connectedAt === "string" &&
    Number.isFinite(Date.parse(item.connectedAt)) &&
    !!target &&
    (target.kind === "space" || target.kind === "plant") &&
    typeof target.id === "string" &&
    target.id.trim().length > 0 &&
    target.id.length <= 200 &&
    typeof target.name === "string" &&
    target.name.trim().length > 0 &&
    target.name.length <= 200
  );
}

/** Both discovery and pairing are simulated, with abortable timers (no network/Bluetooth). */
export function mockDeviceDelay(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("Device connection cancelled."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
