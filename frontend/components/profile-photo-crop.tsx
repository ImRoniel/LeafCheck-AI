import { constrainCrop, cropRectangle, type CropPosition, type Photo } from "@/services/profile-photo";
import { renderProfileCrop } from "@/services/profile-photo-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Notice } from "./screen";

type Touches = { count: number; x: number; y: number; distance: number };
function touches(event: GestureResponderEvent): Touches {
  const points = event.nativeEvent.touches;
  const first = points[0];
  const second = points[1] || first;
  return { count: points.length, x: (first.pageX + second.pageX) / 2, y: (first.pageY + second.pageY) / 2,
    distance: Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY) };
}
export function ProfilePhotoCrop({ photo, onCancel, onConfirm }: {
  photo: Photo; onCancel: () => void; onConfirm: (uri: string) => Promise<void>;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const size = Math.max(120, Math.min(280, window.width - 48, window.height - insets.top - insets.bottom - 340));
  const [position, setPosition] = useState<CropPosition>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(position);
  const start = useRef<{ points: Touches; position: CropPosition } | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const update = (next: CropPosition) => {
    current.current = constrainCrop(photo, size, next);
    setPosition(current.current);
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !pending.current,
    onMoveShouldSetPanResponder: () => !pending.current,
    onPanResponderGrant: event => {
      start.current = { points: touches(event), position: current.current };
      setDragging(true);
    },
    onPanResponderMove: event => {
      const points = touches(event);
      if (!start.current || start.current.points.count !== points.count) {
        start.current = { points, position: current.current };
        return;
      }
      const initial = start.current;
      const ratio = points.count > 1 && initial.points.distance > 0 ? points.distance / initial.points.distance : 1;
      const zoom = Math.min(4, Math.max(1, initial.position.zoom * ratio));
      const scaleChange = zoom / initial.position.zoom;
      update({ zoom, x: initial.position.x * scaleChange + points.x - initial.points.x,
        y: initial.position.y * scaleChange + points.y - initial.points.y });
    },
    onPanResponderRelease: () => { start.current = null; setDragging(false); },
    onPanResponderTerminate: () => { start.current = null; setDragging(false); },
    onPanResponderTerminationRequest: () => false,
  }), [photo, size]);
  const zoom = (delta: number) => {
    const next = Math.min(4, Math.max(1, current.current.zoom + delta));
    const ratio = next / current.current.zoom;
    update({ zoom: next, x: current.current.x * ratio, y: current.current.y * ratio });
  };
  const save = async () => {
    if (pending.current || !loaded) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = await renderProfileCrop(photo, cropRectangle(photo, size, current.current));
      if (mounted.current) await onConfirm(result.uri);
    } catch {
      if (mounted.current) setError("Unable to crop or save this photo. Your previous photo is unchanged. Please try again.");
    } finally {
      if (mounted.current) { pending.current = false; setBusy(false); }
    }
  };
  const scale = Math.max(size / photo.width, size / photo.height) * position.zoom;
  const control = (label: string, text: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy || disabled }}
      disabled={busy || disabled} onPress={onPress} style={[styles.control, (busy || disabled) && styles.disabled]}>
      <Text style={styles.controlText}>{text}</Text>
    </Pressable>
  );
  return (
    <Modal visible animationType="slide" onRequestClose={() => !pending.current && onCancel()}>
      <ScrollView scrollEnabled={!dragging} contentContainerStyle={[styles.page, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <Text accessibilityRole="header" style={styles.title}>Crop profile photo</Text>
        <Text style={styles.hint}>Drag to reposition. Pinch or use the buttons to zoom.</Text>
        <View {...responder.panHandlers} style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
          accessibilityLabel="Circular photo crop preview">
          <Image source={{ uri: photo.uri }} resizeMode="stretch" onLoad={() => setLoaded(true)}
            onError={() => { setLoaded(false); setError("This photo cannot be displayed. Cancel and choose another image."); }}
            style={{ position: "absolute", width: photo.width * scale, height: photo.height * scale,
              left: (size - photo.width * scale) / 2 + position.x, top: (size - photo.height * scale) / 2 + position.y }} />
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.hint}>Zoom {position.zoom.toFixed(1)}× · Saves on this device</Text>
        <View style={styles.controls}>
          {control("Zoom out", "−", () => zoom(-0.25), position.zoom <= 1)}
          {control("Reset crop", "Reset", () => update({ zoom: 1, x: 0, y: 0 }))}
          {control("Zoom in", "+", () => zoom(0.25), position.zoom >= 4)}
        </View>
        <View style={styles.controls}>
          {control("Move photo left", "←", () => update({ ...current.current, x: current.current.x - 16 }))}
          {control("Move photo up", "↑", () => update({ ...current.current, y: current.current.y - 16 }))}
          {control("Move photo down", "↓", () => update({ ...current.current, y: current.current.y + 16 }))}
          {control("Move photo right", "→", () => update({ ...current.current, x: current.current.x + 16 }))}
        </View>
        {!!error && <Notice>{error}</Notice>}
        <View style={styles.controls}>
          {control("Cancel photo crop", "Cancel", onCancel)}
          {control("Confirm profile photo", busy ? "Saving…" : "Use photo", () => void save(), !loaded)}
        </View>
      </ScrollView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff", paddingHorizontal: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: "700", color: "#193E27" },
  hint: { textAlign: "center", color: "#506557", lineHeight: 21 },
  circle: { overflow: "hidden", backgroundColor: "#EAF7EE" },
  controls: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  control: { minWidth: 44, minHeight: 44, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center", alignItems: "center", backgroundColor: "#EAF7EE" },
  controlText: { fontSize: 16, fontWeight: "600", color: "#193E27" },
  disabled: { opacity: 0.45 },
});
