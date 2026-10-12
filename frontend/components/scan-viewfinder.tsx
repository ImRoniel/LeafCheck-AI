import { Ionicons } from "@expo/vector-icons";
import { CameraView, type PermissionResponse } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import type { RefObject } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = {
  cameraRef: RefObject<CameraView | null>;
  cameraKey: number;
  permission: PermissionResponse | null;
  enabled: boolean;
  focused: boolean;
  ready: boolean;
  flash: "off" | "on";
  busy: boolean;
  photoUri?: string;
  serviceFailure?: boolean;
  error: string;
  status: string;
  onClose: () => void;
  onPermission: () => void;
  onReady: () => void;
  onMountError: () => void;
  onCapture: () => void;
  onToggleFlash: () => void;
  onRetake: () => void;
};

export function ScanViewfinder({
  cameraRef,
  cameraKey,
  permission,
  photoUri,
  serviceFailure,
  enabled,
  busy,
  ready,
  flash,
  error,
  focused,
  status,
  onClose,
  onPermission,
  onReady,
  onMountError,
  onCapture,
  onToggleFlash,
  onRetake,
}: Props) {
  return (
    <View style={s.root}>
      {focused && <StatusBar style="light" />}
      {photoUri ? (
        <Image
          source={{ uri: photoUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      ) : permission?.granted && enabled ? (
        <CameraView
          key={cameraKey}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          flash={flash}
          onCameraReady={onReady}
          onMountError={onMountError}
        />
      ) : null}

      <LinearGradient pointerEvents="none" colors={["rgba(4,14,8,0.6)", "rgba(4,14,8,0.28)", "rgba(4,14,8,0)"]} locations={[0, 0.4, 1]} style={s.topFade} />
      <LinearGradient pointerEvents="none" colors={["rgba(4,14,8,0)", "rgba(4,14,8,0.28)", "rgba(4,14,8,0.72)"]} locations={[0, 0.5, 1]} style={s.bottomFade} />

      {/* Only the controls receive safe-area padding; the live feed never does. */}
      <SafeAreaView style={s.overlay} pointerEvents="box-none">
        <View style={s.header}>
          <Text style={s.instruction} textBreakStrategy="balanced" android_hyphenationFrequency="none">
            Fill the frame with leaves
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close plant scanner"
            onPress={onClose}
            style={s.close}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={s.center} pointerEvents="none">
          {permission?.granted && !error && !busy && enabled && (
            <View style={s.frame}>
              <View style={[s.corner, s.topLeft]} />
              <View style={[s.corner, s.topRight]} />
              <View style={[s.corner, s.bottomLeft]} />
              <View style={[s.corner, s.bottomRight]} />
            </View>
          )}
        </View>

        {/* Scroll only the controls when large text or a short viewport needs it. */}
        <ScrollView
          style={s.controls}
          contentContainerStyle={s.controlsContent}
        >
          {!permission ? (
            <View style={s.panel}>
              <ActivityIndicator color="#FFFFFF" />
              <Text style={s.copy}>Getting your camera ready…</Text>
            </View>
          ) : !permission.granted ? (
            <View style={s.panel}>
              <Text style={s.panelTitle}>Let’s see your plant</Text>
              <Text style={s.copy}>
                Allow camera access to photograph the leaves and learn how your
                plant is doing.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={onPermission}
                style={s.button}
              >
                <Text style={s.buttonText}>
                  {permission.canAskAgain ? "Allow camera" : "Open settings"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {busy && (
            <View style={s.panel} accessibilityLiveRegion="polite">
              <ActivityIndicator color="#B0E9B9" />
              <Text style={s.copy}>{status}</Text>
            </View>
          )}
          {!!error && (
            <View
              style={[s.panel, s.errorPanel]}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}
          {permission?.granted &&
            !busy &&
            (photoUri ? (
              <Pressable
                accessibilityRole="button"
                onPress={serviceFailure ? onClose : onRetake}
                style={s.button}
              >
                <Text style={s.buttonText}>
                  {serviceFailure ? "Close scanner" : "Try another photo"}
                </Text>
              </Pressable>
            ) : (
              <View style={s.shutterRow}>
                <Text style={s.hint}>
                  {!enabled
                    ? "Camera paused"
                    : ready
                      ? "Tap to scan"
                      : "Getting camera ready…"}
                </Text>
                <View style={s.captureRow}>
                  <View style={s.sideControl}>
                    <Pressable accessibilityRole="button" accessibilityLabel={flash === "on" ? "Turn off flash" : "Turn on flash"}
                      accessibilityState={{ selected: flash === "on", disabled: !ready || !enabled }} disabled={!ready || !enabled}
                      onPress={onToggleFlash} style={[s.flashButton, (!ready || !enabled) && s.disabled]}>
                      <Ionicons name={flash === "on" ? "flashlight" : "flashlight-outline"} size={24} color="#FFFFFF" />
                    </Pressable>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Capture and scan plant"
                    accessibilityState={{ disabled: !ready || !enabled }}
                    disabled={!ready || !enabled}
                    onPress={onCapture}
                    style={[s.shutter, (!ready || !enabled) && s.disabled]}
                  >
                    <View style={s.shutterInner} />
                  </Pressable>
                  <View style={s.sideControl} pointerEvents="none" />
                </View>
              </View>
            ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#08120C" },
  topFade: { position: "absolute", top: 0, left: 0, right: 0, height: "28%", minHeight: 160, maxHeight: 240 },
  bottomFade: { position: "absolute", bottom: 0, left: 0, right: 0, height: "35%", minHeight: 180, maxHeight: 300 },
  overlay: { flex: 1, justifyContent: "space-between" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  instruction: { color: "#F1F7F2", fontSize: 15, lineHeight: 22, fontWeight: "500", flex: 1, textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  center: {
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  frame: { width: "76%", maxWidth: 420, height: "72%", maxHeight: 420 },
  corner: {
    position: "absolute",
    width: 28,
    height: 28,
    borderColor: "#B0E9B9",
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 12,
  },
  controls: {
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: "60%",
  },
  controlsContent: {
    padding: 20,
    gap: 12,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  panel: { padding: 16, gap: 12, borderRadius: 16, backgroundColor: "#172B20" },
  panelTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "600",
    textAlign: "center",
  },
  copy: { color: "#FFFFFF", fontSize: 16, lineHeight: 24, textAlign: "center" },
  errorPanel: { backgroundColor: "#FFF6DF" },
  errorText: { color: "#56421E", fontSize: 16, lineHeight: 24 },
  button: {
    minHeight: 48,
    padding: 14,
    borderRadius: 24,
    backgroundColor: "#DCF3DF",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: "#143A21",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  shutterRow: { alignItems: "center", gap: 12 },
  captureRow: { flexDirection: "row", alignItems: "center", width: "100%" },
  sideControl: { flex: 1, alignItems: "center" },
  flashButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)", borderWidth: 1, borderColor: "rgba(255,255,255,0.65)" },
  hint: { color: "#FFFFFF", fontSize: 14, textAlign: "center" },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FFFFFF",
  },
  disabled: { opacity: 0.4 },
});
