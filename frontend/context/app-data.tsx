import { fetchUserPlants } from '@/services/api';
import type { Plant } from '@/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';

const Context = createContext<{
  guest: boolean; enterGuest: () => void; leaveGuest: () => void;
  plants: Plant[]; loading: boolean; loaded: boolean; error: string | null; refresh: () => Promise<void>;
  devices: Record<string, string>; saveDevice: (id: string, device: string) => Promise<void>; storageError: string | null;
} | null>(null);
const storageKey = 'leafcheck.device-mappings.v1';
export function AppDataProvider({ children }: PropsWithChildren) {
  const [guest, setGuest] = useState(false);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Record<string, string>>({});
  const [storageError, setStorageError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const deviceRef = useRef<Record<string, string>>({});
  const storageReady = useRef(false);
  useEffect(() => { let active = true; AsyncStorage.getItem(storageKey).then(raw => {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(v => typeof v !== 'string')) throw new Error('Invalid local device settings');
    if (active) { deviceRef.current = value as Record<string, string>; setDevices(deviceRef.current); }
  }).catch(() => { if (active) setStorageError('Local device settings could not be loaded.'); }).finally(() => { storageReady.current = true; });
    return () => { active = false; controller.current?.abort(); };
  }, []);
  const refresh = useCallback(async () => {
    if (!guest) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(null);
    try { const result = await fetchUserPlants({ signal: abort.signal }); if (!abort.signal.aborted) { setPlants(result); setLoaded(true); } }
    catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load plants'); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  }, [guest]);
  useEffect(() => { const timer = setTimeout(() => { if (guest) void refresh(); }, 0); return () => clearTimeout(timer); }, [guest, refresh]);
  const saveDevice = async (id: string, device: string) => {
    if (!storageReady.current) throw new Error('Local settings are still loading.');
    const next = { ...deviceRef.current }; if (device.trim()) next[id] = device.trim(); else delete next[id];
    await AsyncStorage.setItem(storageKey, JSON.stringify(next)); deviceRef.current = next; setDevices(next); setStorageError(null);
  };
  return <Context.Provider value={{ guest, enterGuest: () => setGuest(true), leaveGuest: () => { controller.current?.abort(); setGuest(false); setPlants([]); setLoaded(false); setLoading(false); setError(null); }, plants, loading, loaded, error, refresh, devices, saveDevice, storageError }}>{children}</Context.Provider>;
}
export function useAppData() { const value = useContext(Context); if (!value) throw new Error('AppDataProvider missing'); return value; }
