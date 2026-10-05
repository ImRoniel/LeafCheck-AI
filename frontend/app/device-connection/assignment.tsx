import {
  DeviceConnectionScreen,
  deviceStyles as s,
} from "@/components/device-connection-screen";
import { Action, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { useDeviceActivity } from "@/hooks/use-device-activity";
import { parsePreselectedTarget, resolveDeviceTarget } from "@/services/device-connection";
import type {
  DeviceConnectionRouteParams,
  DeviceTarget,
} from "@/types/device-connection";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

export default function DeviceAssignment() {
  const { deviceId, targetType, targetId } =
    useLocalSearchParams<DeviceConnectionRouteParams>();
  const preselected = parsePreselectedTarget(targetType, targetId);
  const locked = preselected !== undefined;
  const data = useAppData();
  const device = data.pendingDevice;
  const validClaim = !!device && device.id === deviceId && !data.guest;
  const active = useDeviceActivity();
  const router = useRouter();
  const [manualSelection, setSelected] = useState<DeviceTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null);
  const targets: DeviceTarget[] = data.loaded && !data.error && !data.guest
    ? data.plants.filter((plant) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(plant.id)).map((plant) => ({ kind: "plant", id: plant.id, name: plant.name }))
    : [];
  const selected = resolveDeviceTarget(preselected, manualSelection, targets);
  const latest = useRef({ targets, loading: data.loading, preselected, validClaim });
  useLayoutEffect(() => { latest.current = { targets, loading: data.loading, preselected, validClaim }; });
  const cancel = () => {
    work.current?.abort();
    work.current = null;
  };
  useEffect(() => {
    if (active && !work.current) setBusy(false);
    if (!active) {
      work.current?.abort();
      work.current = null;
    }
    return () => {
      work.current?.abort();
      work.current = null;
    };
  }, [active]);

  const connect = async () => {
    if (!validClaim || !selected || !active || work.current || data.loading) return;
    const current = resolveDeviceTarget(latest.current.preselected, selected, latest.current.targets);
    if (!current || current.kind !== "plant" || !latest.current.validClaim || latest.current.loading) return;
    const abort = new AbortController();
    work.current = abort;
    setBusy(true);
    setError(null);
    try {
      const submittedDeviceId = device!.id;
      await data.pairClaimedDevice(current.id, abort.signal);
      const sameContext = latest.current.preselected?.id === preselected?.id && latest.current.preselected?.type === preselected?.type;
      if (!abort.signal.aborted && sameContext)
        router.replace({ pathname: "/device-connection/success", params: { deviceId: submittedDeviceId } });
    } catch {
      if (!abort.signal.aborted)
        setError("The sensor could not be paired. Check your connection and selected plant, then retry.");
    } finally {
      if (work.current === abort) {
        work.current = null;
        setBusy(false);
      }
    }
  };

  const completedRouteClaim = data.confirmedPairing?.device.id === deviceId;
  if (!validClaim && !busy && !completedRouteClaim)
    return <Redirect href={{ pathname: "/device-connection/scanner", params: { targetType, targetId } }} />;
  return (
    <DeviceConnectionScreen
      title="Assign your sensor"
      step={3}
      description="Pair your claimed sensor with an owned plant."
      onCancel={cancel}
    >
      <FlatList
        data={locked ? (selected ? [selected] : []) : targets}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        extraData={[selected, busy]}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Text style={ui.heading}>{device?.name ?? data.confirmedPairing?.device.name ?? "Sensor"}</Text>
            <Text style={s.text}>
              {locked
                ? "Your destination is preselected and locked. "
                : "Choose an existing Plant. "}
              Pairing is confirmed by the server for your account.
            </Text>
            {locked && !selected && !data.loading && (
              <Text accessibilityRole="alert" style={s.status}>
                This pairing destination is invalid or no longer available.
                Return to its detail screen and try again; another destination
                will not be selected automatically.
              </Text>
            )}
            {data.loading && (
              <Text accessibilityLiveRegion="polite" style={s.status}>
                Loading your plants…
              </Text>
            )}
            {data.error && (
              <>
                <Text accessibilityLiveRegion="polite" style={s.status}>
                  Plants could not be loaded. Retry before pairing.
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
              : "No owned Plants are available. Add a plant to your collection, then connect again."}
          </Text>
        }
        renderItem={({ item }) => {
          const checked =
            selected?.kind === item.kind && selected.id === item.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.kind === "space" ? "Space" : "Plant"}: ${item.name}`}
              accessibilityState={{
                selected: checked,
                disabled: busy || locked,
              }}
              aria-pressed={checked}
              accessibilityHint={
                locked
                  ? "Preselected destination; cannot be changed in this flow"
                  : "Select this plant for your sensor"
              }
              disabled={busy || locked}
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
            {completedRouteClaim && <Text accessibilityLiveRegion="polite" style={s.status}>Sensor pairing confirmed.</Text>}
            {busy && (
              <Text accessibilityLiveRegion="polite" style={s.text}>
                Pairing your sensor…
              </Text>
            )}
            <Action
              label={busy ? "Connecting…" : "Connect to selected destination"}
              disabled={
                busy ||
                !validClaim ||
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
              onPress={() =>
                router.replace({
                  pathname: "/device-connection/scanner",
                  params: { targetType, targetId },
                })
              }
            />
          </View>
        }
      />
    </DeviceConnectionScreen>
  );
}
