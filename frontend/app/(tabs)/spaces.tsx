import { SpaceManagement } from "@/components/space-management";
import { SpaceMenuButton, type SpaceMenuAnchor } from "@/components/space-menu-button";
import { ProfileButton } from "@/components/profile-button";
import { AnimatedPressable as Pressable } from "@/components/animated-pressable";
import { useAppData } from "@/context/app-data";
import { useSpaces } from "@/context/spaces";
import { useLocalState } from "@/context/local-state";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, RefreshControl, KeyboardAvoidingView, Platform, Modal, StyleSheet, Text, TextInput, View } from "react-native";
import { useRef, useState } from "react";

export default function SpacesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { spaces, plantsBySpace, addSpace, ready, error: storageError, retry, archivedSpaces, restoreSpace } = useSpaces();
  const appData = useAppData();
  const local = useLocalState();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [managed, setManaged] = useState<{ space: string; anchor: SpaceMenuAnchor } | null>(null);
  const [showArchives, setShowArchives] = useState(false);
  const backgrounds = ["#E8F2E8", "#E3EFEF", "#F3EBD8", "#EDE6F1", "#F5E5DE"];
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [background, setBackground] = useState(backgrounds[0]);
  const nameSuggestions = ["Bedroom", "Balcony", "Porch", "Kitchen", "Garden"];

  const createSpace = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      await addSpace(name, background);
      setName(""); setBackground(backgrounds[0]); setModalVisible(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create space."); }
    finally { pending.current = false; setBusy(false); }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 14, paddingBottom: 0 }]}>
      <View style={styles.header}>
        <View><Text style={styles.my}>MY</Text><Text style={styles.spacesTitle}>SPACES</Text></View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Pressable hitSlop={3} accessibilityRole="button" accessibilityLabel="Open Archive" disabled={!ready} accessibilityState={{ disabled: !ready }} onPress={() => { setError(""); setShowArchives(true); }} style={styles.archiveButton}><Ionicons name="archive-outline" size={22} color="#278448" /></Pressable><ProfileButton /></View>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.spaceList, { paddingBottom: insets.bottom + 170 }]} refreshControl={<RefreshControl refreshing={appData.loading} onRefresh={() => void appData.refresh()} />}>
        {appData.guest && local.data.onboarding.status === "pending" && <Pressable accessibilityRole="button" accessibilityLabel="Set up my garden" style={styles.cancel} onPress={() => router.push("/setup/experience")}><Text>Setup</Text></Pressable>}
        {(!ready || storageError) && <Pressable onPress={() => void retry()}><Text>{storageError || "Loading spaces..."}{storageError ? " Tap to retry." : ""}</Text></Pressable>}
        {!!appData.error && <Text style={styles.error}>{appData.error}</Text>}
        {ready && !storageError && !appData.loading && !appData.error && !spaces.length && <View style={styles.empty}><Text style={{ textAlign: "center", color: "#506557" }}>No My Spaces yet.</Text></View>}
        {spaces.map((space) => {
          const plantCount = plantsBySpace[space]?.length ?? 0;
          const countLabel = `${plantCount} ${plantCount === 1 ? "plant" : "plants"}`;
          return (
          <View key={space} style={styles.spaceCard}>
            <Pressable style={styles.cardOpen} onPress={() => router.push({ pathname: "/(tabs)/space-detail", params: { space } })} accessibilityRole="button" accessibilityLabel={`Open ${space}`} accessibilityHint={`${countLabel}. View this space's plants.`} />
            {space !== "Unassigned" && <SpaceMenuButton style={styles.menuDots} onOpen={anchor => setManaged({ space, anchor })} label={`Manage ${space}`} />}
            <View pointerEvents="box-none" style={styles.cardFooter}>
              <View pointerEvents="none" style={styles.spaceIdentity}>
                <Text style={styles.spaceName}>{space}</Text>
                <Text style={styles.plantCount} accessibilityLabel={`${countLabel} in ${space}`}>{countLabel}</Text>
              </View>
              <Pressable style={styles.addPlant} accessibilityRole="button" accessibilityLabel={`Add a Plant to ${space}`} onPress={event => { event.stopPropagation(); router.push({ pathname: "/(tabs)/space-detail", params: { space, add: "manual" } }); }}><View style={styles.addPlantPill}><Text numberOfLines={1} style={styles.addPlantText}>Add a Plant</Text></View></Pressable>
            </View>
          </View>
          );
        })}
        {!!error && !modalVisible && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <Pressable disabled={!ready} style={[styles.plus, { bottom: insets.bottom + 94 }]} onPress={() => { setError(""); setModalVisible(true); }} accessibilityRole="button" accessibilityLabel="Create a space"><Ionicons name="add" size={35} color="#20B64D" /></Pressable>
      <SpaceManagement space={managed?.space ?? null} anchor={managed?.anchor} onClose={() => setManaged(null)} />
      <Modal visible={showArchives} transparent animationType="fade" onRequestClose={() => { if (!busy) setShowArchives(false); }}>
        <View style={styles.modalBackdrop}><View style={[styles.modalCard, { maxHeight: "90%" }]}><ScrollView>
          <Text accessibilityRole="header" style={styles.modalTitle}>Archive</Text>
          {!archivedSpaces.length && <Text>No archived spaces.</Text>}
          {archivedSpaces.map(space => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Restore ${space.name}`} disabled={busy} accessibilityState={{ disabled: busy }} style={styles.cancel} onPress={() => {
            if (pending.current) return;
            pending.current = true; setBusy(true); setError("");
            void restoreSpace(space.name).catch(e => setError(e instanceof Error ? e.message : "Unable to restore space.")).finally(() => { pending.current = false; setBusy(false); });
          }}><Text style={{ color: "#278448" }}>Restore {space.name}</Text></Pressable>)}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="Close Archive" disabled={busy} style={[styles.cancel, { alignSelf: "flex-end" }]} onPress={() => setShowArchives(false)}><Text>Close</Text></Pressable>
        </ScrollView></View></View>
      </Modal>
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => { if (!busy) setModalVisible(false); }}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalCard}><ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Create a space</Text>
            <TextInput editable={!busy} accessibilityLabel="Space name" autoFocus value={name} onChangeText={(value) => { setName(value); setError(""); }} placeholder="Space name" maxLength={10} style={styles.input} />
            <View style={styles.nameSuggestions}>{nameSuggestions.map(suggestion => (
              <Pressable key={suggestion} accessibilityRole="button" accessibilityLabel={`Use ${suggestion} as space name`} accessibilityState={{ selected: name === suggestion, disabled: busy }} disabled={busy} style={[styles.nameSuggestion, name === suggestion && styles.selectedSuggestion]} onPress={() => { setName(suggestion); setError(""); }}>
                <Text style={styles.nameSuggestionText}>{suggestion}</Text>
              </Pressable>
            ))}</View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.colorLabel}>Choose a background</Text>
            <View style={styles.colors}>{backgrounds.map((color) => <Pressable key={color} disabled={busy} accessibilityState={{ selected: color === background }} onPress={() => setBackground(color)} accessibilityRole="button" accessibilityLabel={`Choose background ${color}`} style={[styles.color, { backgroundColor: color }, background === color && styles.selectedColor]} />)}</View>
            <View style={styles.modalActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel space creation" disabled={busy} onPress={() => setModalVisible(false)} style={styles.cancel}><Text>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Create space" disabled={busy} onPress={() => void createSpace()} style={styles.create}><Text style={styles.createText}>Create</Text></Pressable>
            </View>
          </ScrollView></View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF", paddingHorizontal: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, marginHorizontal: 6, paddingTop: 6 },
  my: { fontSize: 36, lineHeight: 39, color: "#111111", fontWeight: "300" },
  spacesTitle: { fontSize: 36, lineHeight: 39, color: "#20B64D", fontWeight: "300" },
  spaceList: { flexGrow: 1, gap: 12, alignItems: "center", paddingHorizontal: 4 },
  empty: { flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", minHeight: 180 },
  archiveButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#EAF7EE", borderWidth: 1, borderColor: "#B9E5C6", alignItems: "center", justifyContent: "center" },
  spaceCard: { width: 354, maxWidth: "100%", minHeight: 178, borderRadius: 22, borderWidth: 1, borderColor: "#E8E8E8", backgroundColor: "#FFFFFF", paddingHorizontal: 18, paddingBottom: 8, paddingTop: 56, justifyContent: "flex-end", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  cardOpen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 22 },
  menuDots: { position: "absolute", top: 0, right: 4 },
  spaceIdentity: { flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, flexShrink: 1, flexBasis: 172, maxWidth: "100%" },
  spaceName: { fontSize: 27, color: "#171717", flexShrink: 1 },
  plantCount: { fontSize: 12, color: "#278448", fontWeight: "600", flexShrink: 0 },
  cardFooter: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" },
  addPlant: { minHeight: 44, minWidth: 112, flexShrink: 0, justifyContent: "center", maxWidth: "100%" },
  addPlantPill: { minWidth: 112, alignItems: "center", backgroundColor: "#278448", borderRadius: 50, paddingHorizontal: 16, paddingVertical: 6 },
  addPlantText: { fontSize: 12, color: "#FFFFFF", textAlign: "center" },
  plus: { position: "absolute", right: 31, bottom: 91, width: 55, height: 55, borderRadius: 28, borderWidth: 2, borderColor: "#20B64D", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", zIndex: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", borderRadius: 22, backgroundColor: "#FFFFFF", padding: 22 },
  modalTitle: { fontSize: 22, fontWeight: "700", color: "#25833C", marginBottom: 15 },
  input: { borderWidth: 1, borderColor: "#25B853", borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 16 },
  nameSuggestions: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  nameSuggestion: { minHeight: 44, justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: "#E0EBE2", backgroundColor: "#F3FAF4", paddingHorizontal: 12 },
  selectedSuggestion: { borderColor: "#278448", backgroundColor: "#EAF7EE" },
  nameSuggestionText: { fontSize: 13, color: "#278448", fontWeight: "500" },
  error: { color: "#D93636", marginTop: 8, fontSize: 13 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 18 },
  cancel: { padding: 12 },
  create: { backgroundColor: "#36BF5A", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  createText: { color: "#FFFFFF", fontWeight: "700" },
  colorLabel: { color: "#66746A", marginTop: 16, marginBottom: 8 },
  colors: { flexDirection: "row", gap: 10 },
  color: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: "#DBE7DA" },
  selectedColor: { borderWidth: 3, borderColor: "#278448" },
});
