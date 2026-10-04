import { Action, Notice, ui } from "@/components/screen";
import { ProfilePhotoCrop } from "@/components/profile-photo-crop";
import { useAuth } from "@/context/auth";
import { useProfile } from "@/context/profile";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { pickProfilePhoto } from "@/services/profile-photo-native";
import type { Photo } from "@/services/profile-photo";
import { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Profile() {
  const auth = useAuth();
  const profile = useProfile();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [editor, setEditor] = useState<"name" | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const edit = () => {
    setValue(profile.name);
    setNotice("");
    setEditor("name");
  };
  const choosePhoto = () => void perform(async () => {
    setNotice("");
    if (Platform.OS === "web") { setNotice("Choose a gallery photo in the iOS or Android app."); return; }
    try {
      const photo = await pickProfilePhoto();
      if (mounted.current && photo) setSelectedPhoto(photo);
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : "Unable to open your gallery. Please try again.");
    }
  });
  const perform = async (work: () => void | Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await work(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Please try again."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const settings = () => auth.isLocal ? setNotice("Sign in to manage device settings.") : router.push("/settings");
  const accountNotice = (field: string) => setNotice(auth.isLocal
    ? "Sign in to manage account details." : `${field} changes are not available yet.`);
  const rows = [
    { label: "Edit Email", icon: "mail-outline" as const, onPress: () => accountNotice("Email") },
    { label: "Edit Password", icon: "lock-closed-outline" as const, onPress: () => accountNotice("Password") },
  ];
  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back}
            onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")}>
            <Ionicons name="chevron-back" size={22} color="#222" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={settings} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal" size={26} color="#222" />
          </Pressable>
        </View>
        <Pressable style={styles.avatar} accessibilityRole="button" accessibilityLabel="Choose profile photo from gallery"
          accessibilityState={{ disabled: busy }} disabled={busy} onPress={choosePhoto}>
          {profile.photoUri ? <Image source={{ uri: profile.photoUri }} style={styles.photo} />
            : <Ionicons name="person-outline" size={58} color="#20A64A" />}
          <View style={styles.plus}><Ionicons name="add" size={19} color="#fff" /></View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit profile name" style={styles.nameRow} onPress={edit}>
          <Text style={styles.name}>{profile.name}</Text><Ionicons name="pencil-outline" size={17} color="#555" />
        </Pressable>
        <Text style={styles.email}>{profile.email || "Local session · On this device"}</Text>
        <View style={styles.card}>
          {rows.map((row, index) => <Pressable key={row.label} accessibilityRole="button" onPress={row.onPress}
            style={[styles.row, index < rows.length - 1 && styles.divider]}>
            <Ionicons name={row.icon} size={20} color="#20A64A" /><Text style={styles.rowLabel}>{row.label}</Text>
            <Ionicons name="chevron-forward" size={17} color="#777" />
          </Pressable>)}
        </View>
        <View style={styles.actions}>
          {!!(notice || auth.error) && <Notice>{notice || auth.error}</Notice>}
          {auth.isLocal ? <>
            <Action label="Sign in" onPress={() => router.push("/login")} />
            <Action label="Create account" onPress={() => router.push("/register")} />
            <Action label="End local session" disabled={busy} onPress={() => void perform(auth.leaveLocal)} />
          </> : <>
            <Action label="Device settings" onPress={settings} />
            <Action label={busy ? "Signing out…" : "Sign out"} disabled={busy} onPress={() => void perform(auth.logout)} />
          </>}
          <Action label="Terms and limitations" onPress={() => router.push("/terms")} />
        </View>
      </ScrollView>
      <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={() => !busy && setEditor(null)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Rename profile</Text>
            <TextInput style={ui.input} accessibilityLabel="Profile name"
              value={value} onChangeText={setValue} editable={!busy} maxLength={100}
              autoCapitalize="words" autoCorrect />
            {!!notice && <Notice>{notice}</Notice>}
            <View style={styles.modalActions}>
              <Pressable disabled={busy} onPress={() => setEditor(null)} accessibilityRole="button" style={styles.modalButton}><Text>Cancel</Text></Pressable>
              <Pressable disabled={busy} accessibilityRole="button" style={styles.modalButton} onPress={() => void perform(async () => {
                await profile.setName(value);
                setEditor(null);
              })}><Text style={styles.save}>{busy ? "Saving…" : "Save"}</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {selectedPhoto && <ProfilePhotoCrop photo={selectedPhoto} onCancel={() => setSelectedPhoto(null)}
        onConfirm={async uri => {
          await profile.savePhoto(uri);
          if (mounted.current) { setSelectedPhoto(null); setNotice("Profile photo saved on this device."); }
        }} />}
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fff" }, content: { paddingHorizontal: 24 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#F3F3F3", alignItems: "center", justifyContent: "center" },
  avatar: { width: 110, height: 110, borderRadius: 55, backgroundColor: "#EAF7EE", alignSelf: "center", marginTop: 45, alignItems: "center", justifyContent: "center" },
  photo: { width: 110, height: 110, borderRadius: 55 },
  plus: { position: "absolute", bottom: 0, right: 0, width: 25, height: 25, borderRadius: 13, backgroundColor: "#20A64A", alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 18 },
  name: { fontSize: 22, fontWeight: "700", color: "#222", flexShrink: 1 }, email: { textAlign: "center", color: "#777", marginTop: 6 },
  card: { borderWidth: 1, borderColor: "#E6E6E6", borderRadius: 16, paddingHorizontal: 16, marginTop: 35 },
  row: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12 }, rowLabel: { flex: 1, color: "#333", fontSize: 15 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#EEE" }, actions: { gap: 12, marginTop: 24 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", padding: 24 },
  modal: { width: "100%", maxWidth: 360, backgroundColor: "#fff", borderRadius: 20, padding: 20, gap: 16 },
  modalTitle: { fontSize: 20, fontWeight: "700", color: "#222" }, hint: { color: "#666", lineHeight: 21 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 }, modalButton: { padding: 12 }, save: { color: "#20A64A", fontWeight: "700" },
});
