import {
  DeviceConnectionScreen,
  deviceStyles as s,
} from "@/components/device-connection-screen";
import { Action, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useLocalState } from "@/context/local-state";
import { useSpaces } from "@/context/spaces";
import { useDeviceActivity } from "@/hooks/use-device-activity";
import {
  createMockConnection,
  deviceTargets,
  findMockDevice,
  mockDeviceDelay,
} from "@/services/device-connection";
import type { DeviceTarget } from "@/types/device-connection";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

export default function DeviceAssignment() {
  const { deviceId } = useLocalSearchParams<{ deviceId?: string }>();
  const device = findMockDevice(deviceId);
  const data = useAppData();
  const local = useLocalState();
  const { spaces } = useSpaces();
  const active = useDeviceActivity();
  const router = useRouter();
  const [selected, setSelected] = useState<DeviceTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null);
  // "Unassigned" is a collection bucket, not an existing Space.
  const targets = deviceTargets(
    (data.loaded && !data.error
      ? spaces
      : local.data.spaces.map((space) => space.name)
    ).filter(
      (name) =>
        name !== "Unassigned" ||
        local.data.spaces.some((space) => space.name === name),
    ),
    data.loaded && !data.error ? data.plants : [],
  );
  const latest = useRef({ targets, local, loading: data.loading });
  useLayoutEffect(() => {
    latest.current = { targets, local, loading: data.loading };
  });
  const cancel = () => {
    work.current?.abort();
    work.current = null;
  };
  useEffect(() => {
    const reset = active ? setTimeout(() => setBusy(false), 0) : undefined;
    if (!active) {
      work.current?.abort();
      work.current = null;
    }
    return () => {
      clearTimeout(reset);
      work.current?.abort();
      work.current = null;
    };
  }, [active]);

  const connect = async () => {
    if (!device || !selected || !active || work.current || data.loading) return;
    const abort = new AbortController();
    work.current = abort;
    setBusy(true);
    setError(null);
    try {
      await mockDeviceDelay(1400, abort.signal);
      if (abort.signal.aborted) return;
      if (latest.current.loading) throw new Error("Collection updating");
      const connection = createMockConnection(
        device.id,
        selected,
        latest.current.targets,
      );
      await latest.current.local.update((state) => {
        if (abort.signal.aborted) throw new Error("Cancelled");
        // Revalidate after waiting for the persistence queue.
        createMockConnection(device.id, selected, latest.current.targets);
        return { ...state, mockDeviceConnection: connection };
      });
      if (!abort.signal.aborted) router.replace("/device-connection/success");
    } catch {
      if (!abort.signal.aborted)
        setError(
          "The demo assignment could not be saved. Check your selection and retry. No physical device was connected.",
        );
    } finally {
      if (work.current === abort) {
        work.current = null;
        setBusy(false);
      }
    }
  };

  if (!device) return <Redirect href="/device-connection/scanner" />;
  return (
    <DeviceConnectionScreen
      title="Assign your sensor"
      step={3}
      onCancel={cancel}
    >
      <FlatList
        data={targets}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        extraData={[selected, busy]}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Text style={ui.heading}>{device.name}</Text>
            <Text style={s.text}>
              Choose an existing Space or Plant. This assignment is saved only
              on this device for the current account or guest profile.
            </Text>
            {data.loading && (
              <Text accessibilityLiveRegion="polite" style={s.status}>
                Loading your plants…
              </Text>
            )}
            {data.error && (
              <>
                <Text accessibilityLiveRegion="polite" style={s.status}>
                  Plants could not be loaded. Retry, or choose an existing local
                  Space.
                </Text>
                <Action
                  label="Retry loading plants"
                  onPress={() => void data.refresh()}
                  disabled={busy || data.loading}
                />
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={s.status}>
            {data.loading
              ? "Please wait for your collection."
              : "No Spaces or Plants are available. Return to the dashboard and add one in My Spaces, then connect again."}
          </Text>
        }
        renderItem={({ item }) => {
          const checked =
            selected?.kind === item.kind && selected.id === item.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.kind === "space" ? "Space" : "Plant"}: ${item.name}`}
              accessibilityState={{ selected: checked, disabled: busy }}
              aria-pressed={checked}
              accessibilityHint="Select this destination for the mock sensor"
              disabled={busy}
              onPress={() => setSelected(item)}
              style={[s.node, checked && s.selected]}
            >
              <Text style={ui.heading}>
                {checked ? "✓ " : ""}
                {item.name}
              </Text>
              <Text style={s.text}>
                {item.kind === "space" ? "Space" : "Plant"}
              </Text>
            </Pressable>
          );
        }}
        ListFooterComponent={
          <View style={{ gap: 12 }}>
            {error && (
              <Text accessibilityRole="alert" style={s.status}>
                {error}
              </Text>
            )}
            {busy && (
              <Text accessibilityLiveRegion="polite" style={s.text}>
                Saving mock connection…
              </Text>
            )}
            <Action
              label={busy ? "Connecting…" : "Connect to selected destination"}
              disabled={
                busy ||
                data.loading ||
                !selected ||
                !targets.some(
                  (item) =>
                    item.kind === selected.kind && item.id === selected.id,
                )
              }
              onPress={() => void connect()}
            />
            <Action
              label="Choose another device"
              disabled={busy}
              onPress={() => router.replace("/device-connection/selection")}
            />
          </View>
        }
      />
    </DeviceConnectionScreen>
  );
}
