import { DeviceConnectionScreen, deviceStyles as s } from "@/components/device-connection-screen";
import { Action, Notice, ui } from "@/components/screen";
import { useAppData } from "@/context/app-data";
import { session, useAuth } from "@/context/auth";
import { useDeviceActivity } from "@/hooks/use-device-activity";
import { claimDevice } from "@/services/api";
import { asApiError } from "@/services/errors";
import { normalizeMac } from "@/services/validators";
import type { DeviceConnectionRouteParams } from "@/types/device-connection";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";

export default function DeviceScanner() {
  const router = useRouter();
  const { targetType, targetId } = useLocalSearchParams<DeviceConnectionRouteParams>();
  const auth = useAuth();
  const data = useAppData();
  const active = useDeviceActivity();
  const [permission, requestPermission] = useCameraPermissions();
  const [mac, setMac] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null);
  const scanning = useRef(true);
  const lifecycle = useRef(0);
  const latest = useRef({ active, generation: auth.generation, userId: auth.user?.id, targetType, targetId });
  useLayoutEffect(() => {
    latest.current = { active, generation: auth.generation, userId: auth.user?.id, targetType, targetId };
  });
  const cancel = () => {
    lifecycle.current++;
    work.current?.abort();
    work.current = null;
  };
  useEffect(() => {
    setBusy(false);
    return cancel;
  }, [active, auth.generation, auth.user?.id, targetType, targetId]);
  const current = (abort: AbortController) => {
    const snapshot = session.snapshot();
    return !abort.signal.aborted && latest.current.active &&
      snapshot.status === "authenticated" && snapshot.generation === auth.generation &&
      snapshot.user?.id === auth.user?.id && latest.current.generation === auth.generation &&
      latest.current.targetType === targetType && latest.current.targetId === targetId;
  };
  const submit = async (value: string) => {
    if (!active || auth.status !== "authenticated" || work.current) return;
    let normalized: string;
    try { normalized = normalizeMac(value); }
    catch { setError("Enter a valid Device ID, such as LC-A50528 or AA:BB:CC:DD:EE:FF."); return; }
    const abort = new AbortController();
    work.current = abort;
    setBusy(true);
    setError(null);
    try {
      const device = await claimDevice(normalized, undefined, { signal: abort.signal });
      if (!current(abort)) return;
      data.rememberClaimedDevice(device);
      router.replace({ pathname: "/device-connection/assignment", params: { deviceId: device.id, targetType, targetId } });
    } catch (cause) {
      if (current(abort)) {
        const failure = asApiError(cause);
        setError(failure.status === 409
          ? "This device belongs to another account. Check the Device ID and try again."
          : `${failure.message} Try again when you are ready.`);
      }
    } finally {
      if (work.current === abort) {
        work.current = null;
        if (current(abort)) setBusy(false);
      }
    }
  };
  return (
    <DeviceConnectionScreen title="Claim your device" step={1} onCancel={cancel}
      description="Power on your pre-configured sensor, then claim its printed Device ID and link it to your plant.">
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {auth.status !== "authenticated" ? (
          <View style={{ gap: 12 }}>
            <Notice>Sign in to claim a physical device. Manual plant care and image scanning remain available without a device.</Notice>
            <Action label="Sign in" onPress={() => router.push("/login")} />
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={ui.card}>
              <Text accessibilityRole="header" style={ui.heading}>How to set up your sensor</Text>
              <Text style={s.text}>1. Plug in the sensor configured for your Wi-Fi network.</Text>
              <Text style={s.text}>2. Keep that Wi-Fi network available. The sensor connects automatically.</Text>
              <Text style={s.text}>3. Ask your system administrator to approve the printed Device ID.</Text>
              <Text style={s.text}>4. Enter or scan that Device ID below, then choose a plant.</Text>
              <Text style={s.text}>If your Wi-Fi details have changed, ask your system administrator to reconfigure the sensor.</Text>
            </View>
            <Text style={s.text}>Enter the Device ID printed on your sensor, or scan a barcode or QR code containing that ID.</Text>
            <TextInput accessibilityLabel="Device ID" style={ui.input} value={mac}
              onChangeText={(value) => { setMac(value); scanning.current = true; }}
              autoCapitalize="characters" autoCorrect={false} editable={!busy}
              placeholder="LC-A50528" onSubmitEditing={() => void submit(mac)} />
            {error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={s.status}>{error}</Text>}
            <Action label={busy ? "Claiming…" : "Claim device"} disabled={busy || !active} onPress={() => void submit(mac)} />
            {permission?.granted && active ? (
              <CameraView style={{ height: 240 }} facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr", "code128", "code39", "ean13", "ean8"] }}
                onBarcodeScanned={busy ? undefined : ({ data: value }) => {
                  if (!scanning.current || work.current) return;
                  scanning.current = false;
                  setMac(value);
                  void submit(value);
                }} />
            ) : (
              <Notice>Camera access is optional. You can enter the Device ID manually.</Notice>
            )}
            {!permission?.granted && permission?.canAskAgain && (
              <Action label="Allow camera scanning" disabled={busy || !active} onPress={() => {
                const boundary = lifecycle.current;
                void requestPermission().catch(() => {
                  const snapshot = session.snapshot();
                  if (boundary === lifecycle.current && latest.current.active &&
                    snapshot.generation === auth.generation && snapshot.user?.id === auth.user?.id)
                    setError("Camera access is unavailable. Enter the Device ID manually.");
                });
              }} />
            )}
            {permission?.granted && <Action label="Scan again" disabled={busy || !active} onPress={() => { scanning.current = true; setError(null); }} />}
          </View>
        )}
      </ScrollView>
    </DeviceConnectionScreen>
  );
}
