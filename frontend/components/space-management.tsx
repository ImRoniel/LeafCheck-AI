import { useSpaces } from "@/context/spaces";
import type { SpaceMenuAnchor } from "./space-menu-button";
import { actionMenuStyles, useActionMenuFont } from "./action-menu-style";
import { AnchoredActionOverlay } from "./anchored-action-overlay";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "./animated-pressable";
export function SpaceManagement({ space, anchor, onClose, onManaged, variant = "collection" }: {
  space: string | null; anchor?: SpaceMenuAnchor; onClose: () => void; onManaged?: () => void;
  variant?: "collection" | "detail";
}) {
  const collection = useSpaces();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [selectedSpace, setSelectedSpace] = useState("");
  const lastAnchor = useRef(anchor);
  if (anchor) lastAnchor.current = anchor;
  const displayedAnchor = anchor ?? lastAnchor.current;
  const fontFamily = useActionMenuFont();
  const dropdown = !!displayedAnchor && !confirmDelete && !confirmArchive && !archiving;
  const close = () => { if (!lock.current) { setError(""); setConfirmDelete(false); setConfirmArchive(false); setArchiving(false); onClose(); } };
  const chooseArchive = () => { setSelectedSpace(space ?? ""); setConfirmArchive(true); };
  const manage = async (action: "archive" | "delete") => {
    if (!space || lock.current) return;
    const target = action === "archive" && variant === "collection" ? selectedSpace : space;
    if (!target || (action === "archive" && collection.spaces && !collection.spaces.includes(target))) { setError("Choose an available space."); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      await (action === "archive" ? collection.archiveSpace(target) : collection.deleteSpace(target));
      setConfirmDelete(false); setConfirmArchive(false); setArchiving(false); onClose(); onManaged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to manage space."); }
    finally { lock.current = false; setBusy(false); }
  };
  if (dropdown) return <AnchoredActionOverlay visible={!!space} anchor={displayedAnchor} closeLabel="Close space menu" onClose={close}>
        <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 3 }}>
        {(["archive", "delete"] as const).map(action => <Pressable key={action} accessibilityRole="button" accessibilityLabel={action === "archive" ? "Archive" : "Delete"} onPress={() => {
          if (action === "delete") setConfirmDelete(true);
          else chooseArchive();
        }} style={actionMenuStyles.button}>
          <Text style={[actionMenuStyles.label, { fontFamily, color: action === "delete" ? "#FF0005" : "#34C759" }]}>{action === "archive" ? "Archive" : "Delete"}</Text>
        </Pressable>)}
        </ScrollView>
    </AnchoredActionOverlay>;
  return <Modal visible={!!space} transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
    <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <View style={{ width: "100%", maxWidth: 354, maxHeight: "90%", borderRadius: 22, borderWidth: 1, borderColor: "#E8E8E8", backgroundColor: "#FFFFFF", padding: 22 }}><ScrollView keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "700", color: "#25833C", marginBottom: 15 }}>{confirmDelete ? `Delete ${space}?` : confirmArchive ? "Archive space" : space}</Text>
        {confirmArchive && <View style={{ gap: 8 }}>
          <Ionicons name="archive-outline" size={32} color="#278448" />
          <Text>{variant === "detail" ? `Archive ${space}? You can restore it from Archive.` : "Select a space to archive. You can restore it from Archive."}</Text>
          {variant === "collection" && (collection.spaces ?? [space]).filter(name => name && name !== "Unassigned").map(name => <Pressable key={name} accessibilityRole="radio" accessibilityLabel={`Archive space ${name}`} accessibilityState={{ selected: selectedSpace === name, disabled: busy }} disabled={busy} onPress={() => setSelectedSpace(name!)} style={{ minHeight: 44, padding: 12, borderWidth: 1, borderRadius: 22, borderColor: selectedSpace === name ? "#278448" : "#E8E8E8", backgroundColor: selectedSpace === name ? "#EAF7EE" : "#FFFFFF" }}><Text style={{ color: "#278448", textAlign: "center" }}>{name}</Text></Pressable>)}
          <Pressable accessibilityRole="button" accessibilityLabel="Confirm archive space" disabled={busy || !selectedSpace} accessibilityState={{ disabled: busy || !selectedSpace }} onPress={() => { setArchiving(true); void manage("archive"); }} style={{ minHeight: 44, paddingHorizontal: 16, paddingVertical: 8, alignSelf: "center", borderRadius: 22, backgroundColor: "#278448", marginTop: 8 }}><Text style={{ color: "#FFFFFF", textAlign: "center" }}>{busy ? "Archiving…" : "Confirm Archive"}</Text></Pressable>
        </View>}
        {confirmDelete && <Text>This removes the space. Plant records are kept.</Text>}
        {archiving && busy && <ActivityIndicator accessibilityLabel="Archiving space" color="#278448" />}
        {!!error && <Text accessibilityRole="alert" style={{ color: "#D93636", marginTop: 8 }}>{error}</Text>}
        {(confirmArchive ? [] : confirmDelete ? ["delete"] as const : ["archive", "delete"] as const).map(action => <Pressable key={action} accessibilityRole="button" accessibilityLabel={confirmDelete ? "Confirm delete space" : action === "archive" ? "Archive" : "Delete"} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => action === "archive" ? chooseArchive() : !confirmDelete ? setConfirmDelete(true) : void manage(action)} style={{ minHeight: 44, padding: 12, marginTop: 8, borderRadius: 22, borderWidth: 1, borderColor: "#E8E8E8", flexDirection: "row", alignItems: "center", gap: 10 }}><Ionicons name={action === "archive" ? "archive-outline" : "trash-outline"} size={20} color={action === "delete" ? "#D93636" : "#278448"} /><Text style={{ color: action === "delete" ? "#D93636" : "#278448", fontWeight: "700", flexShrink: 1 }}>{confirmDelete ? (busy ? "Deleting…" : "Delete") : action === "archive" ? "Archive" : "Delete"}</Text></Pressable>)}
        <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={{ padding: 14, alignSelf: "flex-end" }}><Text>Cancel</Text></Pressable>
      </ScrollView></View>
    </View>
  </Modal>;
}
