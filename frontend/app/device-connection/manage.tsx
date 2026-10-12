import { Action, Notice, Screen, ui } from "@/components/screen";
import { AnimatedPressable as Pressable } from "@/components/animated-pressable";
import { useAppData } from "@/context/app-data";
import { useAuth } from "@/context/auth";
import { useSensorOverview } from "@/hooks/use-sensor-overview";
import { useDeviceActivity } from "@/hooks/use-device-activity";
import { api } from "@/services/api";
import { sensorStatusLabel } from "@/services/dashboard-summary";
import { groupSensorOverview, overviewReadingStatus } from "@/services/sensor-overview";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

export default function ManageDevices() {
  const auth = useAuth();
  const data = useAppData();
  const overview = useSensorOverview();
  const router = useRouter();
  const active = useDeviceActivity();
  const work = useRef<AbortController | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState<{ generation: number; links: string[] }>({ generation: auth.generation, links: [] });
  const authenticated = auth.status === "authenticated";
  const linkKey = (deviceId: string, plantId: string) => `${deviceId}:${plantId}`;
  const entries = overview.entries.map(entry => ({ ...entry, plants: entry.plants.filter(plant =>
    confirmed.generation !== auth.generation || !confirmed.links.includes(linkKey(entry.device.id, plant.id))) }));

  useEffect(() => {
    const reset = active ? setTimeout(() => { if (!work.current) setBusyKey(null); }, 0) : undefined;
    return () => { clearTimeout(reset); work.current?.abort(); work.current = null; };
  }, [active, auth.generation, authenticated]);

  // Keep a committed unlink visible until the inventory acknowledges it, even
  // when a pre-mutation poll or a failed refresh still contains the old link.
  useEffect(() => {
    if (!overview.ready || confirmed.generation !== auth.generation || !confirmed.links.length) return;
    const links = confirmed.links.filter(key => overview.entries.some(entry =>
      entry.plants.some(plant => linkKey(entry.device.id, plant.id) === key)));
    if (links.length === confirmed.links.length) return;
    const timer = setTimeout(() => setConfirmed(current => current === confirmed ? { ...current, links } : current), 0);
    return () => clearTimeout(timer);
  }, [overview.entries, overview.ready, confirmed, auth.generation]);

  const refresh = () => { setMessage(""); void Promise.allSettled([overview.refresh(), data.refresh()]); };
  const unlink = async (deviceId: string, plantId: string) => {
    const entry = entries.find(item => item.device.id === deviceId);
    const plant = entry?.plants.find(item => item.id === plantId);
    if (!authenticated || !active || work.current || !overview.ready || overview.error || !plant) return;
    const abort = new AbortController();
    work.current = abort; setBusyKey(linkKey(deviceId, plantId)); setMessage("");
    try {
      const result = await api.pairDeviceToPlant(plantId, null, { signal: abort.signal });
      if (abort.signal.aborted || work.current !== abort) return;
      if (result.id !== plantId || result.deviceId) throw new Error("Unlink was not confirmed.");
      setConfirmed(current => ({ generation: auth.generation, links: [
        ...(current.generation === auth.generation ? current.links : []), linkKey(deviceId, plantId),
      ] }));
      setMessage(`Sensor unlinked from ${plant.name}.`);
      const results = await Promise.allSettled([overview.refresh(), data.refresh()]);
      if (!abort.signal.aborted && work.current === abort && results[0].status === "rejected") {
        setMessage(`Sensor unlinked from ${plant.name}. Couldn’t refresh the inventory. Refresh sensors to confirm the latest status.`);
      }
    } catch {
      if (!abort.signal.aborted && work.current === abort) setMessage("Could not confirm unlinking. Refresh sensors before retrying.");
    } finally {
      if (work.current === abort) { work.current = null; if (!abort.signal.aborted) setBusyKey(null); }
    }
  };

  if (!authenticated) return <Screen title="Manage Devices" back><Notice>Sign in to manage sensors.</Notice></Screen>;
  const now = new Date();
  const ordered = groupSensorOverview(entries, "", now, Boolean(overview.error)).flatMap(group => group.entries);
  const disabled = !active || busyKey !== null || overview.loading || Boolean(overview.error);
  return <Screen title="Manage Devices" back backgroundColor="#F4F9F4" refresh={refresh} loading={overview.loading}>
    {!overview.ready && !overview.error && <Text accessibilityLiveRegion="polite" style={ui.text}>Loading account sensors…</Text>}
    {overview.loading && overview.ready && <Text style={ui.text}>Refreshing sensors…</Text>}
    {overview.error && <Notice>{overview.errorMessage || "Couldn’t refresh your sensors."}{overview.ready ? " Showing saved devices." : ""}</Notice>}
    {message && <Notice>{message}</Notice>}
    <Action label="Refresh sensors" variant="secondary" disabled={!active || overview.loading || busyKey !== null} onPress={refresh} />
    {overview.ready && !overview.error && !ordered.length && <Text style={ui.text}>No sensors claimed for this account.</Text>}
    {ordered.map(entry => {
      const status = overviewReadingStatus(entry, now, Boolean(overview.error));
      return <View key={entry.device.id} style={s.card}>
        <Text accessibilityRole="header" style={s.name}>{entry.device.name}</Text>
        <Text style={s.id}>{entry.device.macAddress}</Text>
        <Text style={[s.badge, entry.demo && s.demo]}>{entry.demo ? "Demo sensor · simulated readings" : "Physical sensor"}</Text>
        <Text style={ui.text}>{status === "waiting" && !entry.plants.length ? "Waiting for first reading" : sensorStatusLabel(status)}</Text>
        <Text style={s.meta}>{entry.telemetry ? `Last reading · ${new Date(entry.telemetry.timestamp).toLocaleString()}` : status === "error" ? "Last reading unavailable" : "No readings received yet"}</Text>
        {!entry.plants.length && <Text style={s.meta}>Not linked to a plant</Text>}
        {entry.plants.map(plant => <View key={plant.id} style={s.linkRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${plant.name}`} onPress={() => router.push({ pathname: "/plant-profile", params: { id: plant.id } })} style={s.plantLink}>
            <Text style={s.plant}>{plant.name} ›</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Unlink ${entry.device.macAddress} from ${plant.name}`} disabled={disabled}
            accessibilityState={{ disabled, busy: busyKey === linkKey(entry.device.id, plant.id) }}
            onPress={() => void unlink(entry.device.id, plant.id)} style={[s.unlink, disabled && s.disabled]}>
            <Text style={s.unlinkText}>{busyKey === linkKey(entry.device.id, plant.id) ? "Unlinking…" : "Unlink"}</Text>
          </Pressable>
        </View>)}
      </View>;
    })}
    <Action label="Pair a new sensor" disabled={!active || busyKey !== null} onPress={() => router.push("/device-connection/scanner")} />
  </Screen>;
}
const s = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#D4E7D5", borderRadius: 20, padding: 18, gap: 8 },
  name: { color: "#1A4D2E", fontSize: 18, fontWeight: "700" }, id: { color: "#1A4D2E", fontSize: 14, fontWeight: "600" },
  badge: { alignSelf: "flex-start", color: "#278448", backgroundColor: "#E7F4E9", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, fontSize: 12 },
  demo: { color: "#75591D", backgroundColor: "#FFF3CF" }, meta: { color: "#607065", fontSize: 13, lineHeight: 20 },
  linkRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: "#E4EEE5", paddingTop: 4 },
  plantLink: { flexGrow: 1, minHeight: 44, justifyContent: "center" }, plant: { color: "#278448", fontSize: 14, fontWeight: "600" },
  unlink: { minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#EDF5EF" },
  unlinkText: { color: "#278448", fontSize: 14, fontWeight: "600" }, disabled: { opacity: 0.45 },
});
