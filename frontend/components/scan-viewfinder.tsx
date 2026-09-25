import { Ionicons } from "@expo/vector-icons";
import { CameraView, type PermissionResponse } from "expo-camera";
import { StatusBar } from "expo-status-bar";
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
  permission: PermissionResponse | null;
  enabled: boolean;
  focused: boolean;
  ready: boolean;
  busy: boolean;
  photoUri?: string;
  serviceFailure?: boolean;
  error: string;
  status: string;
  existingPlant: boolean;
  onClose: () => void;
  onPermission: () => void;
  onReady: () => void;
  onMountError: () => void;
  onCapture: () => void;
  onRetake: () => void;
};

export function ScanViewfinder({
  cameraRef,
  permission,
  photoUri,
  serviceFailure,
  enabled,
  busy,
  ready,
  error,
  focused,
  existingPlant,
  status,
  onClose,
  onPermission,
  onReady,
  onMountError,
  onCapture,
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
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          onCameraReady={onReady}
          onMountError={onMountError}
        />
      ) : null}

      {/* Only the controls receive safe-area padding; the live feed never does. */}
      <SafeAreaView style={s.overlay} pointerEvents="box-none">
        <View style={s.header}>
          <View style={s.titleRow}>
            <Text accessibilityRole="header" style={s.title}>
              Scan plant
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
          <Text
            style={s.subtitle}
            textBreakStrategy="balanced"
            android_hyphenationFrequency="none"
          >
            {existingPlant
              ? "Check your plant’s health."
              : "Get to know your plant."}
          </Text>
          <Text
            style={s.subtitle}
            textBreakStrategy="balanced"
            android_hyphenationFrequency="none"
          >
            Fill the frame with leaves.
          </Text>
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
              </View>
            ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#08120C" },
  overlay: { flex: 1, justifyContent: "space-between" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: "rgba(4, 14, 8, 0.72)",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { color: "#FFFFFF", fontSize: 26, fontWeight: "700", flex: 1 },
  close: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  subtitle: { color: "#F1F7F2", fontSize: 16, lineHeight: 24, flexShrink: 1 },
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
    backgroundColor: "rgba(4, 14, 8, 0.72)",
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
