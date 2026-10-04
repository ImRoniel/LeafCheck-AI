import { SpaceManagement } from "@/components/space-management";
import { PlantActionMenu } from "@/components/plant-action-menu";
import { SpaceMenuButton, type SpaceMenuAnchor } from "@/components/space-menu-button";
import { AnchoredActionOverlay } from "@/components/anchored-action-overlay";
import { actionMenuStyles, useActionMenuFont } from "@/components/action-menu-style";
import { AnimatedPressable as Pressable } from "@/components/animated-pressable";
import { useSpaces } from "@/context/spaces";
import { useAppData } from "@/context/app-data";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image, RefreshControl, ScrollView, KeyboardAvoidingView, Platform, Modal, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function SpaceDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fontScale = 1 } = useWindowDimensions();
  const { space, add } = useLocalSearchParams<{ space?: string; add?: string }>();
  const currentSpace = typeof space === "string" ? space : "";
  const { spaces, plantsBySpace, addPlant, ready, error: storageError, retry } = useSpaces();
  const valid = ready && spaces.includes(currentSpace);
  const appData = useAppData();
  const plants = plantsBySpace[currentSpace] ?? [];
  const [modalVisible, setModalVisible] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [optionsAnchor, setOptionsAnchor] = useState<SpaceMenuAnchor>();
  const plusButton = useRef<View>(null);
  const menuFont = useActionMenuFont();
  const [managed, setManaged] = useState<SpaceMenuAnchor | null>(null);
  const [plantMenu, setPlantMenu] = useState<{ id: string; anchor: SpaceMenuAnchor } | null>(null);
  const [species, setSpecies] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [plantName, setPlantName] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const removeMode = useRef(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteLock = useRef(false);
  const [deleteError, setDeleteError] = useState("");
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const selectedPlant = plants.find(plant => plant.id === deleteId);
  const cancelDelete = () => { if (!deleteLock.current) { setDeleteId(null); setDeleteError(""); } };
  const deletePlant = async () => {
    if (!valid || appData.guest || !selectedPlant || deleteLock.current) return;
    deleteLock.current = true; setDeleting(true); setDeleteError("");
    try { await appData.deletePlant(selectedPlant.id); setDeleteId(null); }
    catch (e) { setDeleteError(e instanceof Error ? e.message : "Unable to delete plant."); }
    finally { deleteLock.current = false; setDeleting(false); }
  };

  const close = () => { if (!busy) { setModalVisible(false); setError(""); router.setParams({ add: "" }); } };
  const createPlant = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      await addPlant(currentSpace, plantName, species);
      setPlantName(""); setSpecies(""); setModalVisible(false); router.setParams({ add: "" });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to add plant."); }
    finally { pending.current = false; setBusy(false); }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 14, paddingBottom: 0 }]}>
      <View style={styles.topRow}>
        <Pressable hitSlop={6} onPress={() => router.replace("/(tabs)/spaces")} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color="#111111" />
        </Pressable>
        {valid && currentSpace !== "Unassigned" && <SpaceMenuButton variant="detail" style={{ marginRight: 4 }} onOpen={setManaged} label="Manage space" />}
      </View>
      <Text style={styles.title}>{space || "Space"}</Text>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 170 }} refreshControl={<RefreshControl refreshing={appData.loading} onRefresh={() => void appData.refresh()} />}>
      {!!appData.error && <Text style={styles.error}>{appData.error}</Text>}
      {!!storageError && <Pressable onPress={() => void retry()}><Text style={styles.error}>{storageError} Tap to retry.</Text></Pressable>}
      {!valid && <Text>{ready ? "This space is unavailable. Return to My Spaces." : "Loading space..."}</Text>}
      {valid && !plants.length && <Text>No plants here yet. Use the plus button to add one.</Text>}
      {removing && <View style={styles.removalRow}>
        <Text style={{ flex: 1 }}>{appData.guest ? "Sign in to delete plants. Local plants cannot be deleted here." : "Choose a plant to delete."}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel plant removal" disabled={deleting} onPress={() => { removeMode.current = false; setRemoving(false); cancelDelete(); }} style={styles.cancel}><Text style={{ color: "#278448" }}>Cancel</Text></Pressable>
      </View>}
      <View style={styles.plantGrid}>
        {plants.map(plant => (
          <View key={plant.id} style={styles.plantCard}>
            <Pressable style={styles.cardOpen} onLongPress={() => { removeMode.current = true; setRemoving(true); }} onPress={() => { if (!appData.guest && !removeMode.current) router.push({ pathname: "/plant-profile", params: { id: plant.id } }); }} accessibilityRole="button" accessibilityLabel={`Open ${plant.name}`} accessibilityHint="Long press to manage plants" />
            {removing && <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${plant.name}`} accessibilityState={{ disabled: appData.guest || deleting }} disabled={appData.guest || deleting} onPress={event => { event.stopPropagation(); setDeleteError(""); setDeleteId(plant.id); }} style={styles.removePlant}><View style={styles.minus}><Ionicons name="remove" size={12} color="#D93636" /></View></Pressable>}
            <View pointerEvents="none">
            {plant.imageUrl && !failedImages[plant.imageUrl]
              ? <Image source={{ uri: plant.imageUrl }} resizeMode="cover" accessibilityLabel={`${plant.name} photo`} style={styles.plantImage} onError={() => { const uri = plant.imageUrl!; setFailedImages(current => ({ ...current, [uri]: true })); }} />
              : <View style={[styles.plantImage, styles.plantImagePlaceholder]}><Ionicons name="leaf-outline" size={64} color="#2E8A3F" /></View>}
            </View>
            <View pointerEvents="box-none" style={styles.plantFooter}>
              <View pointerEvents="none" style={styles.plantNameContainer}><Text style={styles.plantName}>{plant.name}</Text></View>
              {!removing && <SpaceMenuButton variant="plant" style={styles.plantDots} label={`Manage plant ${plant.name}`} onOpen={anchor => setPlantMenu({ id: plant.id, anchor })} />}
            </View>
          </View>
        ))}
      </View>
      </ScrollView>
      {valid && <Pressable ref={plusButton} collapsable={false} style={[styles.detailPlus, { bottom: insets.bottom + 94 }]} onPress={() => {
        plusButton.current?.measureInWindow((x, y, width, height) => { setOptionsAnchor({ x, y, width, height }); setOptionsVisible(true); });
      }} accessibilityRole="button" accessibilityLabel="Add plant" accessibilityState={{ expanded: optionsVisible }}>
        <Ionicons name="add" size={35} color="#20B64D" />
      </Pressable>}
      <SpaceManagement variant="detail" space={managed ? currentSpace : null} anchor={managed ?? undefined} onClose={() => setManaged(null)} onManaged={() => router.replace("/(tabs)/spaces")} />
      <PlantActionMenu plant={valid ? plants.find(plant => plant.id === plantMenu?.id) : undefined} anchor={plantMenu?.anchor}
        guest={appData.guest} onClose={() => setPlantMenu(null)} onDelete={id => { if (valid && plants.some(plant => plant.id === id)) { setDeleteError(""); setDeleteId(id); } }} />
      <Modal visible={!!selectedPlant && valid && !appData.guest} transparent animationType="fade" onRequestClose={cancelDelete}>
        <View style={styles.modalBackdrop}><View style={styles.optionsCard}>
          <Text accessibilityRole="header" style={styles.modalTitle}>Delete {selectedPlant?.name}?</Text>
          <Text>This permanently deletes the plant and its saved identifications and AI analyses.</Text>
          {!!deleteError && <Text accessibilityRole="alert" style={styles.error}>{deleteError}</Text>}
          <View style={[styles.modalActions, { flexWrap: "wrap" }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel plant deletion" disabled={deleting} onPress={cancelDelete} style={styles.cancel}><Text>Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete plant" accessibilityState={{ disabled: deleting }} disabled={deleting} onPress={() => void deletePlant()} style={[styles.create, { backgroundColor: "#D93636", minHeight: 44 }]}><Text style={styles.createText}>{deleting ? "Deleting…" : "Delete"}</Text></Pressable>
          </View>
        </View></View>
      </Modal>
      <AnchoredActionOverlay visible={optionsVisible && valid} anchor={optionsAnchor} placement="left" menuWidth={Math.ceil(112 * Math.max(1, fontScale))} closeLabel="Close add plant menu" onClose={() => setOptionsVisible(false)}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 3 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Scan Plant" style={[actionMenuStyles.button, styles.addMenuButton]} onPress={() => { setOptionsVisible(false); router.push({ pathname: "/(tabs)/scanner", params: { space: currentSpace } }); }}><Text style={[actionMenuStyles.label, styles.addMenuText, { fontFamily: menuFont }]}>Scan Plant</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Add a Plant" style={[actionMenuStyles.button, styles.addMenuButton]} onPress={() => { setOptionsVisible(false); setError(""); setModalVisible(true); }}><Text style={[actionMenuStyles.label, styles.addMenuText, { fontFamily: menuFont }]}>Add a Plant</Text></Pressable>
        </ScrollView>
      </AnchoredActionOverlay>
      <Modal visible={(modalVisible || add === "manual") && valid} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalCard}><ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Add a plant</Text>
            <TextInput editable={!busy} accessibilityLabel="Plant name" autoFocus value={plantName} onChangeText={(value) => { setPlantName(value); setError(""); }} placeholder="Plant name" maxLength={10} style={styles.input} />
            <Text style={{ marginVertical: 8 }}>Species</Text>
            <TextInput editable={!busy} accessibilityLabel="Plant species" value={species} onChangeText={setSpecies} placeholder="e.g. Basil" maxLength={200} style={styles.input} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel adding plant" disabled={busy} onPress={close} style={styles.cancel}><Text>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Add plant to ${currentSpace}`} disabled={busy} onPress={() => void createPlant()} style={styles.create}><Text style={styles.createText}>Add</Text></Pressable>
            </View>
          </ScrollView></View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF", paddingHorizontal: 16 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  back: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: "#111111", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, color: "#111111", marginTop: 22, marginBottom: 8 },
  plantGrid: { flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", justifyContent: "space-between", rowGap: 17, paddingBottom: 80 },
  plantCard: { width: "47%", borderRadius: 18, borderWidth: 1, borderColor: "#E8E8E8", backgroundColor: "#FFFFFF", overflow: "hidden" },
  cardOpen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 18 },
  plantImage: { width: "100%", aspectRatio: 1 },
  plantImagePlaceholder: { backgroundColor: "#EEF7EF", alignItems: "center", justifyContent: "center" },
  plantFooter: { flexDirection: "row", alignItems: "center", minHeight: 56, paddingLeft: 10, paddingRight: 4, paddingTop: 4, paddingBottom: 4, backgroundColor: "#FFFFFF" },
  removalRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  plantDots: { alignSelf: "flex-end", flexShrink: 0 },
  removePlant: { position: "absolute", top: 2, right: 2, width: 44, height: 44, zIndex: 1, alignItems: "center", justifyContent: "center" },
  minus: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: "#D93636", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  plantNameContainer: { flex: 1, marginRight: 4 },
  plantName: { fontSize: 14, fontWeight: "600", color: "#222222" },
  detailPlus: { position: "absolute", right: 31, bottom: 91, width: 55, height: 55, borderRadius: 28, borderWidth: 2, borderColor: "#20B64D", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", zIndex: 3 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", borderRadius: 22, backgroundColor: "#FFFFFF", padding: 22 },
  modalTitle: { fontSize: 22, fontWeight: "700", color: "#25833C", marginBottom: 15 },
  optionsCard: { width: 280, maxWidth: "100%", maxHeight: "90%", borderRadius: 18, backgroundColor: "#FFFFFF", padding: 16 },
  addMenuButton: { paddingHorizontal: 12 },
  addMenuText: { color: "#34C759" },
  input: { borderWidth: 1, borderColor: "#25B853", borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 16 },
  error: { color: "#D93636", marginTop: 8, fontSize: 13 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 18 },
  cancel: { padding: 12, minHeight: 44, justifyContent: "center" },
  create: { backgroundColor: "#36BF5A", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  createText: { color: "#FFFFFF", fontWeight: "700" },
});
