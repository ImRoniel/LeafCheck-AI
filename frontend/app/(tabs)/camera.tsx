// ─────────────────────────────────────────────────────────────────────────────
// LeafCheck — Scan-First AI Camera
//
// Primary entry point for plant creation. Captures a photo, identifies the
// species via Pl@ntNet, then triggers the full AI pipeline (Perenual specs,
// ESP32 telemetry, Gemini diagnostics + task generation).
// ─────────────────────────────────────────────────────────────────────────────

import { ScanViewfinder } from "@/components/scan-viewfinder";
import { Notice, Screen } from "@/components/screen";
import { measurement } from "@/components/telemetry-history";
import { useAppData } from "@/context/app-data";
import { useAuth } from "@/context/auth";
import { useScan } from "@/hooks/use-scan";
import {
  scanErrorMessage,
  scanNeedsServiceRecovery,
} from "@/services/scan-errors";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

const MAX_BASE64_LENGTH = 4_000_000;

function playSuccessChime() {
  try {
    if (typeof window !== "undefined") {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(587.33, now); // D5
        gain1.gain.setValueAtTime(0.2, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.3);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(880, now + 0.12); // A5
        gain2.gain.setValueAtTime(0.25, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.45);
      }
    }
  } catch {
    // Ignore audio context playback restrictions
  }
}

export default function Camera() {
  const auth = useAuth();
  const router = useRouter();
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
  const { plantId, deviceId } = useLocalSearchParams<{
    plantId?: string;
    deviceId?: string;
  }>();
  const data = useAppData();
  const flow = useScan();
  const busy = capturing || flow.scanning || flow.synchronizing;
  const enabled = focused && active && auth.status === "authenticated";
  const enabledRef = useRef(enabled);

  // ── Lifecycle ───────────────────────────────────────────────────────────
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

  // ── Capture ─────────────────────────────────────────────────────────────
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
          "Image is too large. Retake with a lower-resolution setting.",
        );
      setPhoto({ uri: result.uri, base64: result.base64 });
      setReady(false);

      // Auto-submit immediately for scan-first flow
      await submitScan(result.base64);
    } catch (e) {
      if (alive.current && token === generation.current)
        setError(scanErrorMessage(e));
    } finally {
      lock.current = false;
      if (alive.current) setCapturing(false);
    }
  };

  // ── Submit scan ─────────────────────────────────────────────────────────
  const submitScan = async (base64?: string) => {
    setError("");
    try {
      await flow.scan({
        imageBase64: base64 ?? photo!.base64,
        // Scan-first: plantId is optional
        ...(plantId ? { plantId } : {}),
        ...(deviceId ? { deviceId } : {}),
      });
      // Success haptic + chime sound
      playSuccessChime();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* Hook retains report and distinct errors. */
    }
  };

  const retrySync = async () => {
    if (lock.current || !enabledRef.current) return;
    lock.current = true;
    setError("");
    try {
      await flow.retrySynchronization();
    } catch {
      /* Hook retains error. */
    } finally {
      lock.current = false;
    }
  };

  const report = flow.report;

  // ── Guest / unauthenticated gate ────────────────────────────────────────
  if (auth.status !== "authenticated") {
    return (
      <Screen title="AI Camera" back>
        <View style={s.gateContainer}>
          <Text style={s.gateIcon}>📷</Text>
          <Text style={s.gateTitle}>Sign in to scan plants</Text>
          <Text style={s.gateSubtitle}>
            Sign in to identify your plant, check its health, and save your
            results.
          </Text>
          <Pressable
            style={s.primaryButton}
            onPress={() => router.push("/login")}
          >
            <Text style={s.primaryButtonText}>Sign in</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (!report) {
    return (
      <ScanViewfinder
        cameraRef={camera}
        permission={permission}
        enabled={enabled}
        focused={focused}
        ready={ready}
        busy={busy}
        photoUri={photo?.uri}
        serviceFailure={scanNeedsServiceRecovery(flow.error)}
        error={error || (flow.error ? scanErrorMessage(flow.error) : "")}
        status={
          flow.scanning
            ? "Getting to know your plant…"
            : flow.synchronizing
              ? "Saving your plant…"
              : "Taking your photo…"
        }
        existingPlant={!!plantId}
        onClose={() => {
          ++generation.current;
          enabledRef.current = false;
          flow.cancel();
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)");
        }}
        onPermission={() => {
          setError("");
          void (
            permission?.canAskAgain
              ? requestPermission()
              : Linking.openSettings()
          ).catch(() =>
            setError(
              "We couldn’t open your camera settings. Please allow camera access in your device settings, then come back.",
            ),
          );
        }}
        onReady={() => setReady(true)}
        onMountError={() => {
          setReady(false);
          setError(
            "We couldn’t start your camera. Close the scanner and try again. If needed, allow camera access in your device settings.",
          );
        }}
        onCapture={() => void capture()}
        onRetake={() => {
          setPhoto(null);
          setReady(false);
          setError("");
          flow.reset();
        }}
      />
    );
  }

  return (
    <Screen title="Scan results" back>
      {/* ── Scan Report ──────────────────────────────────────────────────── */}
      {report && (
        <View style={s.reportCard}>
          <View style={s.reportHeader}>
            <Text style={s.reportBadge}>
              {report.diagnostic.healthStatus === "healthy"
                ? "✅"
                : report.diagnostic.healthStatus === "warning"
                  ? "⚠️"
                  : "🔴"}{" "}
              {report.diagnostic.healthStatus.toUpperCase()}
            </Text>
          </View>

          <Text style={s.reportSpecies}>
            {report.identification.commonName ??
              report.identification.speciesName}
          </Text>
          <Text style={s.reportScientific}>
            {report.identification.speciesName}
          </Text>
          <Text style={s.reportConfidence}>
            Confidence: {(report.identification.confidence * 100).toFixed(1)}%
          </Text>

          <View style={s.divider} />

          <Text style={s.reportSectionTitle}>Diagnostic Report</Text>
          <Text selectable style={s.reportBody}>
            {report.diagnostic.rawAnalysisText ||
              "No analysis text was returned."}
          </Text>

          <View style={s.divider} />

          <Text style={s.reportSectionTitle}>Telemetry</Text>
          <Text style={s.reportMeta}>
            {report.diagnostic.telemetryFreshness}
          </Text>
          {report.telemetry ? (
            <View style={s.telemetryGrid}>
              <View style={s.telemetryItem}>
                <Text style={s.telemetryValue}>
                  {measurement(report.telemetry.temperature, "°C")}
                </Text>
                <Text style={s.telemetryLabel}>Temperature</Text>
              </View>
              <View style={s.telemetryItem}>
                <Text style={s.telemetryValue}>
                  {measurement(report.telemetry.humidity, "%")}
                </Text>
                <Text style={s.telemetryLabel}>Humidity</Text>
              </View>
              <View style={s.telemetryItem}>
                <Text style={s.telemetryValue}>
                  {measurement(report.telemetry.soilMoisture, "%")}
                </Text>
                <Text style={s.telemetryLabel}>Soil Moisture</Text>
              </View>
              <View style={s.telemetryItem}>
                <Text style={s.telemetryValue}>
                  {measurement(report.telemetry.lightLevel, " lux")}
                </Text>
                <Text style={s.telemetryLabel}>Light</Text>
              </View>
            </View>
          ) : (
            <Notice>No sensor telemetry was included in this scan.</Notice>
          )}

          {/* ── Care Tasks ──────────────────────────────────────────────── */}
          {report.careTasks.length > 0 && (
            <>
              <View style={s.divider} />
              <Text style={s.reportSectionTitle}>📋 Upcoming Care Tasks</Text>
              {report.careTasks.map((task, i) => (
                <View key={i} style={s.taskCard}>
                  <View style={s.taskHeader}>
                    <Text style={s.taskTitle}>{task.title}</Text>
                    <View
                      style={[
                        s.urgencyBadge,
                        task.urgency === "urgent" && s.urgencyUrgent,
                        task.urgency === "immediate" && s.urgencyImmediate,
                      ]}
                    >
                      <Text style={s.urgencyText}>
                        {task.urgency.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.taskDesc}>{task.description}</Text>
                  <Text style={s.taskDue}>
                    Due: {new Date(task.dueDate).toLocaleDateString()}
                  </Text>
                </View>
              ))}
            </>
          )}

          {/* ── Notification ────────────────────────────────────────────── */}
          {report.notification && (
            <>
              <View style={s.divider} />
              <View style={s.notifCard}>
                <Text style={s.notifTitle}>🔔 Next Check-in</Text>
                <Text style={s.notifTime}>
                  {new Date(report.notification.notifyAt).toLocaleString()}
                </Text>
                <Text style={s.notifReason}>{report.notification.reason}</Text>
              </View>
            </>
          )}

          {/* ── Sync status / actions ───────────────────────────────────── */}
          {flow.synchronizationError && (
            <>
              <Notice>
                Your scan results are still here. We couldn’t update your garden
                just now. Check your connection and tap Retry Sync.
              </Notice>
              <Pressable
                style={s.secondaryButton}
                disabled={busy}
                onPress={() => void retrySync()}
              >
                <Text style={s.secondaryButtonText}>Retry Sync</Text>
              </Pressable>
            </>
          )}
          {flow.phase === "complete" && (
            <View style={s.successBanner}>
              <Text style={s.successText}>
                ✅ Plant saved and health synchronized
              </Text>
            </View>
          )}
          <Pressable
            style={s.primaryButton}
            disabled={busy}
            onPress={() => {
              flow.reset();
              setPhoto(null);
              setReady(false);
              setError("");
            }}
          >
            <Text style={s.primaryButtonText}>New Scan</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  gateContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    minHeight: 300,
  },
  gateIcon: { fontSize: 48, marginBottom: 16 },
  gateTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1A3D1E",
    marginBottom: 8,
  },
  gateSubtitle: {
    fontSize: 14,
    color: "#5A6B5E",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: "#25B853",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: "center",
    marginVertical: 6,
    shadowColor: "#1A8C3B",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#F3F8F2",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: "center",
    marginVertical: 6,
    borderWidth: 1,
    borderColor: "#D0E4D0",
  },
  secondaryButtonText: {
    color: "#1A3D1E",
    fontSize: 15,
    fontWeight: "600",
  },

  // ── Report card ─────────────────────────────────────────────────────────
  reportCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E0EDE0",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  reportHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  reportBadge: { fontSize: 18, fontWeight: "700" },
  reportSpecies: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1A3D1E",
    marginBottom: 2,
  },
  reportScientific: {
    fontSize: 14,
    fontStyle: "italic",
    color: "#5A6B5E",
    marginBottom: 4,
  },
  reportConfidence: {
    fontSize: 13,
    color: "#25B853",
    fontWeight: "600",
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: "#E8F0E8",
    marginVertical: 16,
  },
  reportSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1A3D1E",
    marginBottom: 8,
  },
  reportBody: {
    fontSize: 14,
    color: "#333D35",
    lineHeight: 22,
  },
  reportMeta: {
    fontSize: 13,
    color: "#6B8A72",
    marginBottom: 8,
  },
  telemetryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  telemetryItem: {
    backgroundColor: "#F3F8F2",
    borderRadius: 12,
    padding: 12,
    minWidth: "46%",
    flex: 1,
  },
  telemetryValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1A3D1E",
  },
  telemetryLabel: {
    fontSize: 11,
    color: "#6B8A72",
    marginTop: 2,
  },

  // ── Tasks ───────────────────────────────────────────────────────────────
  taskCard: {
    backgroundColor: "#FAFCFA",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E0EDE0",
  },
  taskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  taskTitle: { fontSize: 15, fontWeight: "700", color: "#1A3D1E", flex: 1 },
  urgencyBadge: {
    backgroundColor: "#E8F5E9",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  urgencyImmediate: { backgroundColor: "#FFF3E0" },
  urgencyUrgent: { backgroundColor: "#FFEBEE" },
  urgencyText: { fontSize: 10, fontWeight: "700", color: "#333" },
  taskDesc: {
    fontSize: 13,
    color: "#5A6B5E",
    lineHeight: 18,
    marginBottom: 4,
  },
  taskDue: { fontSize: 12, color: "#25B853", fontWeight: "600" },

  // ── Notification ────────────────────────────────────────────────────────
  notifCard: {
    backgroundColor: "#FFF9E8",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#F5DFA0",
  },
  notifTitle: { fontSize: 15, fontWeight: "700", color: "#8B6914" },
  notifTime: {
    fontSize: 14,
    color: "#5A4A1E",
    fontWeight: "600",
    marginTop: 4,
  },
  notifReason: {
    fontSize: 13,
    color: "#8B7A3A",
    marginTop: 4,
    lineHeight: 18,
  },

  // ── Success banner ──────────────────────────────────────────────────────
  successBanner: {
    backgroundColor: "#E8F5E9",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    marginVertical: 8,
    borderWidth: 1,
    borderColor: "#C8E6C9",
  },
  successText: {
    color: "#2E7D32",
    fontWeight: "600",
    fontSize: 14,
  },
});
