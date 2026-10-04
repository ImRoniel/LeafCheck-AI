import { useRef } from "react";
import { ScrollView, Text } from "react-native";
import { AnimatedPressable as Pressable } from "./animated-pressable";
import type { SpaceMenuAnchor } from "./space-menu-button";
import { actionMenuStyles, useActionMenuFont } from "./action-menu-style";
import { AnchoredActionOverlay } from "./anchored-action-overlay";

/** Plant actions deliberately never call space-management persistence. */
export function PlantActionMenu({ plant, anchor, guest, onClose, onDelete }: {
  plant?: { id: string; name: string };
  anchor?: SpaceMenuAnchor;
  guest: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const lastAnchor = useRef(anchor);
  if (anchor) lastAnchor.current = anchor;
  const position = anchor ?? lastAnchor.current;
  const fontFamily = useActionMenuFont();
  const remove = () => {
    if (!plant || guest) return;
    const id = plant.id;
    onClose();
    onDelete(id);
  };
  return <AnchoredActionOverlay visible={!!plant && !!anchor} anchor={position} menuHeight={120} closeLabel="Close plant menu" onClose={onClose}>
      <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 3 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Archive plant unavailable" accessibilityHint="Plant archiving is not supported."
          accessibilityState={{ disabled: true }} disabled style={actionMenuStyles.button}>
          <Text style={[actionMenuStyles.label, { fontFamily, color: "#34C759", opacity: 0.6 }]}>Archive</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${plant?.name ?? "plant"}`}
          accessibilityState={{ disabled: guest }} disabled={guest} onPress={remove} style={actionMenuStyles.button}>
          <Text style={[actionMenuStyles.label, { fontFamily, color: "#FF0005", opacity: guest ? 0.6 : 1 }]}>Delete</Text>
        </Pressable>
        <Text style={{ fontSize: 11, color: "#506557", textAlign: "center" }}>{guest ? "Sign in to delete. Archive unavailable." : "Plant archiving unavailable."}</Text>
      </ScrollView>
  </AnchoredActionOverlay>;
}

