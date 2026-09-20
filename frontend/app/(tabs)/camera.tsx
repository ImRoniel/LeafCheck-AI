import { CollectionState } from "@/components/plant-list";
import { Action, Notice, Screen, ui } from "@/components/screen";
import { measurement } from "@/components/telemetry-history";
import { useAppData } from "@/context/app-data";
import { useScan } from "@/hooks/use-scan";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

// 4 MB base64 leaves ample JSON overhead under the gateway body limit.
const MAX_BASE64_LENGTH = 4_000_000;
export default function Camera() {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const pathname = usePathname();
  const focused = pathname === "/camera" || pathname.endsWith("/camera");
  const [active, setActive] = useState(AppState.currentState === "active");
  const alive = useRef(true);
  const generation = useRef(0);
  const lock = useRef(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const { plantId } = useLocalSearchParams<{ plantId?: string }>();
  const [selected, setSelected] = useState(plantId ?? "");
  const data = useAppData();
  const flow = useScan();
  const busy = capturing || flow.scanning || flow.synchronizing;
  const enabled = focused && active;
  const enabledRef = useRef(enabled);
  useEffect(() => {
    if (plantId && !flow.report && !lock.current) {
      setSelected(plantId);
      setPhoto(null);
    }
  }, [plantId, flow.report]);
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
      if (state !== "active") {
        enabledRef.current = false;
        ++generation.current;
        setReady(false);
      }
    });
    return () => {
      alive.current = false;
      subscription.remove();
    };
  }, []);
  // Readiness belongs to the mounted native preview and must reset when it unmounts.
  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      ++generation.current;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReady(false);
    }
  }, [enabled]);
  const refreshPlants = data.refresh;
  useEffect(() => {
    if (flow.phase === "complete") void refreshPlants();
  }, [flow.phase, refreshPlants]);
  const capture = async () => {
    if (lock.current || !ready || !enabledRef.current || !camera.current)
      return;
    lock.current = true;
    setCapturing(true);
    setError("");
    const token = generation.current;
    try {
      const result = await camera.current.takePictureAsync({
        quality: 0.25,
        base64: true,
        imageType: "jpg",
        skipProcessing: false,
      });
      if (!alive.current || token !== generation.current || !enabledRef.current)
        return;
      if (!result?.base64) throw new Error("Camera did not return image data.");
      if (result.base64.length >= MAX_BASE64_LENGTH)
        throw new Error(
          "Image is too large to upload safely. Retake with a lower-resolution camera setting.",
        );
      setPhoto({ uri: result.uri, base64: result.base64 });
      setReady(false);
    } catch (e) {
      if (alive.current && token === generation.current)
        setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      lock.current = false;
      if (alive.current) setCapturing(false);
    }
  };
  const submit = async (retry = false) => {
    if (lock.current || !enabledRef.current) return;
    lock.current = true;
    setError("");
    try {
      if (retry) await flow.retrySynchronization();
      else if (photo && data.plants.some((p) => p.id === selected))
        await flow.scan({
          plantId: selected,
          imageBase64: photo.base64,
          ...(data.devices[selected]
            ? { deviceId: data.devices[selected] }
            : {}),
        });
    } catch {
      /* Hook retains report and distinct errors. */
    } finally {
      lock.current = false;
    }
  };
  const report = flow.report;
  return (
    <Screen title="AI Camera">
      <Text style={ui.text}>
        Center one leaf inside the frame. Select an existing plant before
        scanning.
      </Text>
      <CollectionState />
      {!report && (
        <>
          <View style={ui.row}>
            {data.plants.map((p) => (
              <Action
                key={p.id}
                label={`${selected === p.id ? "✓ " : ""}${p.name}`}
                disabled={busy}
                onPress={() => setSelected(p.id)}
              />
            ))}
          </View>
          <Notice>
            {data.devices[selected]
              ? `Device ${data.devices[selected]}: unverified local mapping. Sensor data may be included.`
              : "Image-only scan. No device ID is mapped to this plant."}
          </Notice>
          {!permission ? (
            <Notice>Checking camera permission…</Notice>
          ) : !permission.granted ? (
            <>
              <Notice>Camera access is needed to photograph a leaf.</Notice>
              <Action
                label={
                  permission.canAskAgain
                    ? "Allow camera"
                    : "Open system settings"
                }
                onPress={() => {
                  void (
                    permission.canAskAgain
                      ? requestPermission()
                      : Linking.openSettings()
                  ).catch((e: unknown) =>
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Permission request failed",
                    ),
                  );
                }}
              />
            </>
          ) : (
            <View style={s.preview}>
              {photo ? (
                <Image
                  source={{ uri: photo.uri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : enabled ? (
                <CameraView
                  ref={camera}
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  mode="picture"
                  onCameraReady={() => setReady(true)}
                  onMountError={(event: { message: string }) => {
                    setReady(false);
                    setError(event.message);
                  }}
                />
              ) : (
                <Text style={s.helper}>Camera paused</Text>
              )}
              <View pointerEvents="none" style={s.frame} />
            </View>
          )}
          {photo ? (
            <>
              <Action
                label="Analyze leaf"
                disabled={busy || !data.plants.some((p) => p.id === selected)}
                onPress={() => void submit()}
              />
              <Action
                label="Retake photo"
                disabled={busy}
                onPress={() => {
                  setPhoto(null);
                  setReady(false);
                  setError("");
                }}
              />
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Capture leaf photo"
              accessibilityState={{ disabled: !ready || busy }}
              disabled={!ready || busy}
              onPress={() => void capture()}
              style={[s.shutter, (!ready || busy) && { opacity: 0.4 }]}
            >
              <View style={s.shutterInner} />
            </Pressable>
          )}
        </>
      )}
      {busy && (
        <Notice>
          {capturing
            ? "Capturing…"
            : flow.scanning
              ? "Analyzing leaf…"
              : "Synchronizing plant health…"}
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}
      {flow.error && <Notice>{flow.error.message}</Notice>}
      {report && (
        <View style={ui.card}>
          <Text style={ui.heading}>Scan report</Text>
          <Text style={ui.text}>
            Identification:{" "}
            {report.identification.commonName ||
              report.identification.speciesName}
            {"\n"}Species: {report.identification.speciesName}
            {"\n"}Identification confidence:{" "}
            {(report.identification.confidence * 100).toFixed(1)}%{"\n"}Health:{" "}
            {report.diagnostic.healthStatus}
          </Text>
          <Text selectable style={ui.text}>
            {report.diagnostic.rawAnalysisText ||
              "No analysis prose was returned."}
          </Text>
          <Text style={ui.text}>
            Telemetry freshness: {report.diagnostic.telemetryFreshness}
          </Text>
          {report.telemetry ? (
            <Text style={ui.text}>
              Sample: {new Date(report.telemetry.timestamp).toLocaleString()}
              {"\n"}Temperature:{" "}
              {measurement(report.telemetry.temperature, "°C")}
              {"\n"}Humidity: {measurement(report.telemetry.humidity, "%")}
              {"\n"}Soil moisture:{" "}
              {measurement(report.telemetry.soilMoisture, "%")}
              {"\n"}Light: {measurement(report.telemetry.lightLevel, "lux")}
            </Text>
          ) : (
            <Notice>No sensor telemetry was included in this scan.</Notice>
          )}
          <Notice>
            Identification is a scan result, not a change to this plant’s stored
            species or image. AI prose is not a confirmed diagnosis.
          </Notice>
          {flow.synchronizationError && (
            <>
              <Notice>
                Report retained. Plant synchronization failed:{" "}
                {flow.synchronizationError.message}
              </Notice>
              <Action
                label="Retry synchronization only"
                disabled={busy}
                onPress={() => void submit(true)}
              />
            </>
          )}
          {flow.phase === "complete" && (
            <>
              <Text style={ui.text}>
                Plant health synchronized successfully.
              </Text>
              <Action
                label="Start a new scan"
                disabled={busy}
                onPress={() => {
                  flow.reset();
                  setPhoto(null);
                  setReady(false);
                }}
              />
            </>
          )}
        </View>
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  preview: {
    height: 360,
    backgroundColor: "#1A241D",
    borderRadius: 24,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    width: "74%",
    height: "74%",
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "#25B853",
  },
  helper: { color: "#FFF" },
  shutter: {
    alignSelf: "center",
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 5,
    borderColor: "#25B853",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#25B853",
  },
});
