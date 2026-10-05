import {
  fetchUserPlants,
  pairDeviceToPlant,
  updatePlant as patchPlant,
  createPlant as postPlant,
  deletePlant as removePlant,
  type CreatePlantInput,
  type UpdatePlantInput,
} from "@/services/api";
import { uuid } from "@/services/validators";
import type { Device, Plant } from "@/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { session, useAuth } from "./auth";
import { useLocalState } from "./local-state";

export type ConfirmedPairing = { device: Device; plant: Plant; refreshWarning: string | null };

const Context = createContext<{
  guest: boolean;
  enterGuest: () => void;
  leaveGuest: () => void;
  plants: Plant[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createPlant: (input: CreatePlantInput) => Promise<Plant>;
  updatePlant: (id: string, input: UpdatePlantInput) => Promise<Plant>;
  deletePlant: (id: string) => Promise<void>;
  devices: Record<string, string>;
  saveDevice: (id: string, device: string) => Promise<void>;
  storageError: string | null;
  pendingDevice: Device | null;
  confirmedPairing: ConfirmedPairing | null;
  pairClaimedDevice: (plantId: string, signal?: AbortSignal) => Promise<ConfirmedPairing>;
  rememberClaimedDevice: (device: Device) => void;
  clearPendingDevice: () => void;
} | null>(null);
export function AppDataProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  // Remount all account data (and consumers) at every authentication boundary.
  return (
    <AccountDataProvider
      key={`${auth.generation}:${auth.status}:${auth.user?.id ?? "guest"}`}
    >
      {children}
    </AccountDataProvider>
  );
}
function AccountDataProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  const local = useLocalState();
  const guest = auth.isGuest;
  const authenticated = auth.status === "authenticated";
  const storageKey = `leafcheck.device-mappings.v2:${auth.user ? `account:${encodeURIComponent(auth.user.id)}` : "guest"}`;
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState<string | null>(null);
  const [pendingDevice, setPendingDevice] = useState<Device | null>(null);
  const pendingDeviceRef = useRef<Device | null>(null);
  const [confirmedPairing, setConfirmedPairing] = useState<ConfirmedPairing | null>(null);
  const pairing = useRef(false);
  const plantsRef = useRef(plants);
  plantsRef.current = plants;
  const controller = useRef<AbortController | null>(null);
  const deviceRef = useRef<Record<string, string>>({});
  const storageReady = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  const assertSession = () => {
    const current = session.snapshot();
    if (
      !active.current ||
      !authenticated ||
      current.status !== "authenticated" ||
      current.generation !== auth.generation ||
      current.user?.id !== auth.user?.id
    )
      throw new Error("Session changed. Sign in to manage plants.");
  };
  const rememberClaimedDevice = (device: Device) => {
    assertSession();
    if (device.userId !== auth.user?.id)
      throw new Error("Sign in to claim this device.");
    pendingDeviceRef.current = device;
    setPendingDevice(device);
    setConfirmedPairing(null);
  };
  const clearPendingDevice = () => {
    pendingDeviceRef.current = null;
    if (active.current) setPendingDevice(null);
  };
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        const value: unknown = raw ? JSON.parse(raw) : {};
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.values(value).some((v) => typeof v !== "string")
        )
          throw new Error("Invalid local device settings");
        if (active) {
          deviceRef.current = value as Record<string, string>;
          setDevices(deviceRef.current);
        }
      })
      .catch(() => {
        if (active)
          setStorageError("Local device settings could not be loaded.");
      })
      .finally(() => {
        if (active) storageReady.current = true;
      });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [storageKey]);
  const refreshCollection = useCallback(async () => {
    if (!authenticated) return false;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchUserPlants({ signal: abort.signal });
      assertSession();
      if (!abort.signal.aborted) {
        plantsRef.current = result;
        setPlants(result);
        setLoaded(true);
        return true;
      }
    } catch (e) {
      try { assertSession(); } catch { return false; }
      if (!abort.signal.aborted && active.current)
        setError(e instanceof Error ? e.message : "Unable to load plants");
    } finally {
      const current = session.snapshot();
      if (!abort.signal.aborted && active.current && current.generation === auth.generation && current.user?.id === auth.user?.id) setLoading(false);
    }
    return false;
  }, [authenticated]);
  const refresh = useCallback(async () => { await refreshCollection(); }, [refreshCollection]);
  const pairClaimedDevice = async (plantId: string, signal?: AbortSignal) => {
    assertSession();
    uuid(plantId, "plantId");
    const device = pendingDeviceRef.current;
    if (!device || device.userId !== auth.user?.id)
      throw new Error("Claim a sensor before pairing it.");
    uuid(device.id, "deviceId");
    if (!loaded || loading || error || !plantsRef.current.some((plant) => plant.id === plantId))
      throw new Error("Select an available owned plant before pairing.");
    if (pairing.current) throw new Error("Pairing is already in progress.");
    if (signal?.aborted) throw new Error("Pairing cancelled before submission.");
    pairing.current = true;
    try {
      const plant = await pairDeviceToPlant(plantId, device.id, { signal });
      assertSession();
      if (plant.id !== plantId || plant.deviceId !== device.id)
        throw new Error("The server did not confirm the selected pairing.");
      // Confirmation is a committed server write, even if the screen was cancelled.
      controller.current?.abort();
      const next = plantsRef.current.map((cached) => {
        if (cached.id === plant.id) return plant;
        if (cached.deviceId !== device.id) return cached;
        const { deviceId: previousDevice, ...unpaired } = cached;
        return unpaired;
      });
      plantsRef.current = next;
      setPlants(next);
      setLoading(false);
      setError(null);
      const confirmation: ConfirmedPairing = { device, plant, refreshWarning: null };
      setConfirmedPairing(confirmation);
      clearPendingDevice();
      const refreshed = await refreshCollection();
      assertSession();
      const completed = { ...confirmation, refreshWarning: refreshed ? null : "Sensor paired successfully. The collection could not be refreshed; retry loading your plants." };
      setConfirmedPairing(completed);
      return completed;
    } finally { pairing.current = false; }
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      if (authenticated) void refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [authenticated, refresh]);
  const saveDevice = async (id: string, device: string) => {
    if (!storageReady.current)
      throw new Error("Local settings are still loading.");
    const next = { ...deviceRef.current };
    if (device.trim()) next[id] = device.trim();
    else delete next[id];
    await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    deviceRef.current = next;
    setDevices(next);
    setStorageError(null);
  };
  const createPlant = async (input: CreatePlantInput) => {
    if (guest) {
      const now = new Date().toISOString();
      const plant: Plant = {
        id: `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: input.name.trim(),
        species: input.species.trim(),
        location: input.location?.trim(),
        healthStatus: "unknown",
        createdAt: now,
        updatedAt: now,
      };
      await local.update((state) => ({
        ...state,
        guestPlants: [...state.guestPlants, plant],
      }));
      return plant;
    }
    assertSession();
    const plant = await postPlant(input);
    assertSession();
    // A list request started before this write must not erase the new plant.
    controller.current?.abort();
    setLoading(false);
    setError(null);
    setPlants((current) => [
      plant,
      ...current.filter((item) => item.id !== plant.id),
    ]);
    await refresh();
    assertSession();
    return plant;
  };
  const updatePlant = async (id: string, input: UpdatePlantInput) => {
    assertSession();
    const plant = await patchPlant(id, input);
    assertSession();
    controller.current?.abort();
    setPlants((current) =>
      current.map((item) => (item.id === id ? plant : item)),
    );
    await refresh();
    assertSession();
    return plant;
  };
  const deletePlant = async (id: string) => {
    assertSession();
    await removePlant(id);
    assertSession();
    controller.current?.abort();
    setLoading(false);
    setError(null);
    setPlants((current) => current.filter((plant) => plant.id !== id));
    await refresh();
    assertSession();
  };
  return (
    <Context.Provider
      value={{
        guest,
        enterGuest: auth.enterGuest,
        leaveGuest: auth.leaveGuest,
        plants: guest ? local.data.guestPlants : plants,
        loading,
        loaded: guest ? local.ready : loaded,
        error,
        refresh,
        createPlant,
        updatePlant,
        deletePlant,
        devices,
        saveDevice,
        storageError,
        pendingDevice,
        confirmedPairing,
        pairClaimedDevice,
        rememberClaimedDevice,
        clearPendingDevice,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAppData() {
  const value = useContext(Context);
  if (!value) throw new Error("AppDataProvider missing");
  return value;
}
