import type {
  ConnectedDevice,
  DeviceTarget,
  MockDeviceConnection,
  PreselectedTarget,
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

/** undefined = open mode; null = malformed contextual link (must not unlock). */
export function parsePreselectedTarget(
  type: unknown,
  id: unknown,
): PreselectedTarget | null | undefined {
  if (type === undefined && id === undefined) return undefined;
  if (
    (type !== "plant" && type !== "space") ||
    typeof id !== "string" ||
    !id.trim() ||
    id.length > 200
  )
    return null;
  return { type, id };
}

export function resolveDeviceTarget(
  preselected: PreselectedTarget | null | undefined,
  selected: DeviceTarget | null,
  targets: readonly DeviceTarget[],
): DeviceTarget | null {
  if (preselected === null) return null;
  const kind = preselected?.type ?? selected?.kind;
  const id = preselected?.id ?? selected?.id;
  return (
    targets.find((target) => target.kind === kind && target.id === id) ?? null
  );
}

export function connectedDeviceFromMock(
  connection: MockDeviceConnection,
): ConnectedDevice {
  return {
    id: connection.deviceId,
    name: findMockDevice(connection.deviceId)!.name,
    assignedType: connection.target.kind,
    assignedId: connection.target.id,
    targetName: connection.target.name,
    source: "mock",
    connectedAt: connection.connectedAt,
    telemetry: {},
  };
}

export function upsertConnectedDevice(
  devices: readonly ConnectedDevice[],
  device: ConnectedDevice,
): ConnectedDevice[] {
  const existing = devices.some((item) => item.id === device.id);
  return existing
    ? devices.map((item) => (item.id === device.id ? device : item))
    : [...devices, device];
}

export function isConnectedDevice(value: unknown): value is ConnectedDevice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ConnectedDevice>;
  const telemetry = item.telemetry;
  return (
    isMockDeviceConnection({
      source: item.source,
      deviceId: item.id,
      connectedAt: item.connectedAt,
      target: {
        kind: item.assignedType,
        id: item.assignedId,
        name: item.targetName,
      },
    }) &&
    item.name === findMockDevice(item.id)?.name &&
    !!telemetry &&
    typeof telemetry === "object" &&
    !Array.isArray(telemetry) &&
    Object.entries(telemetry).every(
      ([key, reading]) =>
        ["soilMoisture", "temperature", "humidity"].includes(key) &&
        typeof reading === "number" &&
        Number.isFinite(reading),
    )
  );
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
