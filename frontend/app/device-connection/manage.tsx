import { Action, Notice, Screen, ui } from "@/components/screen";
import { useLocalState } from "@/context/local-state";
import { useDeviceActivity } from "@/hooks/use-device-activity";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

export default function ManageDevices() {
  const local = useLocalState();
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
      <Notice>
        Demo assignments for this account only. No physical hardware is
        connected and no live telemetry is generated. Existing plant sensor
        links and local device mappings are unchanged.
      </Notice>
      <Action
        label="+ Add Sensor"
        disabled={busy}
        onPress={() => router.push("/device-connection/scanner")}
      />
      {error && <Notice>{error}</Notice>}
      {!local.data.connectedDevices.length && (
        <Notice>
          No paired demo sensors. Add a sensor to choose a plant or space.
        </Notice>
      )}
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
                pathname: "/device-connection/assignment",
                params: { deviceId: device.id },
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
