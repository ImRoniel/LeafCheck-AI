import {
  initialLocalState,
  setupSteps,
  type LocalState,
} from "../types/local-state";
import {
  connectedDeviceFromMock,
  isConnectedDevice,
  isMockDeviceConnection,
} from "./device-connection";

export interface LocalStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
}

export function localStateKey(accountId: string | null): string {
  return `leafcheck.local-state.v1:${accountId === null ? "guest" : `account:${encodeURIComponent(accountId)}`}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max = 200): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function date(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function integer(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}
function oneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

export function validProfilePhoto(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol === "file:") return !url.host && !url.search && !url.hash &&
      /^\/.*\/leafcheck-profile-[a-z0-9-]+\.jpg$/.test(url.pathname);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** Fail closed: unknown versions/corrupt state must never be replaced by empty defaults. */
export function parseLocalState(value: unknown): LocalState {
  const fail = () => {
    throw new Error(
      "Local setup data is invalid or from an unsupported version. It has not been overwritten.",
    );
  };
  if (!record(value) || value.version !== 1) return fail();
  if (value.profile !== undefined && (
    !record(value.profile) ||
    (value.profile.name !== undefined && !text(value.profile.name, 100)) ||
    (value.profile.photoUri !== undefined && !validProfilePhoto(value.profile.photoUri))
  )) return fail();
  if (
    value.careCompletions !== undefined &&
    (!Array.isArray(value.careCompletions) ||
      value.careCompletions.length > 500 ||
      !value.careCompletions.every(
        (item: unknown) =>
          record(item) &&
          text(item.id, 20000) &&
          text(item.key, 16000) &&
          text(item.plantId) &&
          text(item.title, 10000) &&
          typeof item.details === "string" &&
          item.details.length <= 20000 &&
          (item.dueAt === null || date(item.dueAt)) &&
          oneOf(item.priority, ["immediate", "routine"]) &&
          date(item.completedAt),
      ) ||
      new Set(value.careCompletions.map((item) => item.id)).size !==
        value.careCompletions.length)
  )
    return fail();
  // Optional additive field: existing v1 installations remain readable.
  if (
    value.mockDeviceConnection !== undefined &&
    !isMockDeviceConnection(value.mockDeviceConnection)
  )
    return fail();
  if (
    value.connectedDevices !== undefined &&
    (!Array.isArray(value.connectedDevices) ||
      !value.connectedDevices.every(isConnectedDevice) ||
      new Set(value.connectedDevices.map((device) => device.id)).size !==
        value.connectedDevices.length)
  )
    return fail();
  if (
    value.experience !== null &&
    !oneOf(value.experience, ["beginner", "intermediate", "experienced"])
  )
    return fail();
  if (
    !Array.isArray(value.spaces) ||
    !value.spaces.every(
      (s: unknown) =>
        record(s) &&
        text(s.id) &&
        text(s.name, 100) &&
        (s.background === undefined || (typeof s.background === "string" && /^#[0-9a-fA-F]{6}$/.test(s.background))) &&
        (s.status === undefined || oneOf(s.status, ["archived", "deleted"])) &&
        date(s.createdAt) &&
        oneOf(s.theme, ["living", "kitchen", "bedroom", "balcony"]) &&
        oneOf(s.light, ["low", "medium", "high"]),
    )
  )
    return fail();
  const spaces = value.spaces as LocalState["spaces"];
  if (
    new Set(spaces.map((s) => s.id)).size !== spaces.length ||
    new Set(spaces.map((s) => s.name.trim().toLowerCase())).size !==
      spaces.length
  )
    return fail();
  if (
    !Array.isArray(value.guestPlants) ||
    !value.guestPlants.every(
      (p: unknown) =>
        record(p) &&
        text(p.id) &&
        p.id.startsWith("guest-") &&
        text(p.name, 100) &&
        text(p.species) &&
        (p.location === undefined ||
          (typeof p.location === "string" && p.location.length <= 100)) &&
        p.deviceId === undefined &&
        p.simulated === undefined &&
        p.healthStatus === "unknown" &&
        date(p.createdAt) &&
        date(p.updatedAt),
    )
  )
    return fail();
  const guestPlants = value.guestPlants as LocalState["guestPlants"];
  if (new Set(guestPlants.map((p) => p.id)).size !== guestPlants.length)
    return fail();
  if (
    !record(value.schedules) ||
    !Object.entries(value.schedules).every(
      ([id, s]) =>
        record(s) &&
        text(id) &&
        s.plantId === id &&
        integer(s.wateringDays, 1, 365) &&
        integer(s.waterMl, 1, 10000) &&
        integer(s.fertilizingDays, 1, 365) &&
        text(s.fertilizer, 100) &&
        integer(s.rotationDays, 1, 365) &&
        typeof s.reminderTime === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(s.reminderTime) &&
        date(s.updatedAt),
    )
  )
    return fail();
  const onboarding = value.onboarding;
  if (
    !record(onboarding) ||
    !oneOf(onboarding.status, ["pending", "completed", "skipped"]) ||
    !oneOf(onboarding.step, setupSteps) ||
    !(
      onboarding.spaceId === null ||
      spaces.some((s) => s.id === onboarding.spaceId)
    ) ||
    !(onboarding.plantId === null || text(onboarding.plantId)) ||
    !(onboarding.mode === null || onboarding.mode === "manual")
  )
    return fail();
  if (
    (onboarding.step === "sensor-choice" || onboarding.step === "care") &&
    !onboarding.plantId
  )
    return fail();
  // A present collection is authoritative, including an explicitly empty one.
  // Remove the legacy field so deleting the last device cannot resurrect it.
  const { mockDeviceConnection, ...current } = value;
  return {
    ...current,
    careCompletions: value.careCompletions ?? [],
    connectedDevices:
      value.connectedDevices ??
      (isMockDeviceConnection(mockDeviceConnection)
        ? [connectedDeviceFromMock(mockDeviceConnection)]
        : []),
  } as unknown as LocalState;
}

export interface LocalSnapshot {
  data: LocalState;
  ready: boolean;
  error: string | null;
}

/** One queue per key also fences writes across provider remounts in the same process. */
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
  const task = (queues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(work);
  queues.set(key, task);
  void task
    .finally(() => {
      if (queues.get(key) === task) queues.delete(key);
    })
    .catch(() => undefined);
  return task;
}

export function createLocalStateStore(
  storage: LocalStorageAdapter,
  key: string,
) {
  let snapshot: LocalSnapshot = {
    data: initialLocalState(),
    ready: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const publish = (next: LocalSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const read = async () => {
    const raw = await storage.getItem(key);
    return raw === null
      ? initialLocalState()
      : parseLocalState(JSON.parse(raw));
  };
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: () =>
      enqueue(key, async () => {
        try {
          publish({ data: await read(), ready: true, error: null });
        } catch {
          publish({
            ...snapshot,
            ready: false,
            error:
              "Local setup could not be loaded. Existing data was not overwritten. Retry storage access or sign out.",
          });
        }
      }),
    update: (change: (state: LocalState) => LocalState) =>
      enqueue(key, async () => {
        if (!snapshot.ready)
          throw new Error(
            "Local setup is not ready. Retry loading before making changes.",
          );
        // Re-read inside the queue to preserve updates from a remounted provider.
        const current = await read();
        const next = parseLocalState(change(current));
        await storage.setItem(key, JSON.stringify(next));
        publish({ data: next, ready: true, error: null });
      }),
  };
}
