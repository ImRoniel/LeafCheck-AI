import { Action, Notice, Screen, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useDashboardTelemetry } from "@/hooks/use-dashboard-data";
import { sensorStatusLabel } from "@/services/dashboard-summary";
import { useLocalState } from "@/context/local-state";
import { useDeviceActivity } from "@/hooks/use-device-activity";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

export default function ManageDevices() {
  const local = useLocalState();
  const data = useAppData();
  const telemetry = useDashboardTelemetry(data.plants, !data.guest && data.loaded);
  const router = useRouter();
  const active = useDeviceActivity();
  const work = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const reset = active ? setTimeout(() => setBusy(false), 0) : undefined;
    return () => {
      clearTimeout(reset);
      work.current?.abort();
      work.current = null;
    };
  }, [active]);

  const remove = async (id: string) => {
    if (!active || work.current) return;
    const abort = new AbortController();
    work.current = abort;
    setBusy(true);
    setError(null);
    try {
      await local.update((state) => {
        if (abort.signal.aborted) throw new Error("Cancelled");
        return {
          ...state,
          connectedDevices: state.connectedDevices.filter(
            (device) => device.id !== id,
          ),
        };
      });
    } catch {
      if (!abort.signal.aborted)
        setError(
          "The demo sensor could not be removed. Your saved assignments are unchanged. Retry when storage is available.",
        );
    } finally {
      if (work.current === abort) {
        work.current = null;
        if (!abort.signal.aborted) setBusy(false);
      }
    }
  };

  return (
    <Screen title="Manage Devices" back>
      <Text accessibilityRole="header" style={ui.heading}>Linked sensors</Text>
      {!data.loaded && <Notice>Loading linked sensors…</Notice>}
      {!!data.error && <><Notice>Couldn’t refresh linked sensors.</Notice><Action label="Retry linked sensors" onPress={() => void data.refresh()} /></>}
      {data.loaded && !data.error && !telemetry.sensors.length && <Notice>{data.guest ? "Sign in to connect a physical sensor." : "No sensors linked to your plants."}</Notice>}
      {telemetry.sensors.map(sensor => <View key={sensor.plant.id} style={ui.card}>
        <Text style={ui.heading}>{sensor.name}</Text>
        {sensor.address && <Text style={ui.text}>{sensor.address}</Text>}
        <Text style={ui.text}>Plant: {sensor.plant.name}</Text>
        <Text style={ui.text}>{sensorStatusLabel(sensor.status)}</Text>
        {sensor.timestamp && Number.isFinite(Date.parse(sensor.timestamp)) && <Text style={ui.text}>Last reading · {new Date(sensor.timestamp).toLocaleString()}</Text>}
        <Action label={`Open ${sensor.plant.name}`} variant="secondary" onPress={() => router.push({ pathname: "/plant-profile", params: { id: sensor.plant.id } })} />
      </View>)}
      <Action
        label="+ Add Sensor"
        disabled={busy}
        onPress={() => router.push("/device-connection/scanner")}
      />
      {error && <Notice>{error}</Notice>}
      {!!local.data.connectedDevices.length && <Text accessibilityRole="header" style={ui.heading}>Local demo assignments</Text>}
      {local.data.connectedDevices.map((device) => (
        <View key={device.id} style={ui.card}>
          <Text style={ui.heading}>{device.name}</Text>
          <Text style={ui.text}>
            {device.assignedType === "plant" ? "Plant" : "Space"}:{" "}
            {device.targetName}
          </Text>
          <Text style={ui.text}>Demo · No live readings</Text>
          <Action
            label={`Reassign ${device.name}`}
            disabled={busy}
            onPress={() =>
              router.push({
                pathname: "/device-connection/scanner",
              })
            }
          />
          <Action
            label={`Remove ${device.name}`}
            disabled={busy}
            onPress={() => void remove(device.id)}
          />
        </View>
      ))}
    </Screen>
  );
}
