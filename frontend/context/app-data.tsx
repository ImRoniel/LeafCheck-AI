import {
  fetchUserPlants,
  createPlant as postPlant,
  deletePlant as removePlant,
  type CreatePlantInput,
} from "@/services/api";
import type { Plant } from "@/types";
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
import { useAuth } from "./auth";

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
  deletePlant: (id: string) => Promise<void>;
  devices: Record<string, string>;
  saveDevice: (id: string, device: string) => Promise<void>;
  storageError: string | null;
} | null>(null);
export function AppDataProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  const guest = auth.isGuest;
  const authenticated = auth.status === "authenticated";
  const storageKey = `leafcheck.device-mappings.v2:${auth.user ? `account:${encodeURIComponent(auth.user.id)}` : "guest"}`;
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const deviceRef = useRef<Record<string, string>>({});
  const storageReady = useRef(false);
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
  const refresh = useCallback(async () => {
    if (!authenticated) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchUserPlants({ signal: abort.signal });
      if (!abort.signal.aborted) {
        setPlants(result);
        setLoaded(true);
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : "Unable to load plants");
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }, [authenticated]);
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
    const plant = await postPlant(input);
    // A list request started before this write must not erase the new plant.
    controller.current?.abort();
    setLoading(false);
    setError(null);
    setPlants((current) => [
      plant,
      ...current.filter((item) => item.id !== plant.id),
    ]);
    return plant;
  };
  const deletePlant = async (id: string) => {
    await removePlant(id);
    controller.current?.abort();
    setLoading(false);
    setError(null);
    setPlants((current) => current.filter((plant) => plant.id !== id));
  };
  return (
    <Context.Provider
      value={{
        guest,
        enterGuest: auth.enterGuest,
        leaveGuest: auth.leaveGuest,
        plants,
        loading,
        loaded,
        error,
        refresh,
        createPlant,
        deletePlant,
        devices,
        saveDevice,
        storageError,
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
