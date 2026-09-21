import { useAppData } from "@/context/app-data";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { Action, Notice, ui } from "./screen";

export function DeletePlantAction({ id, name }: { id: string; name: string }) {
  const { deletePlant } = useAppData();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const remove = async () => {
    if (pending.current) return;
    pending.current = true;
    setDeleting(true);
    setError(null);
    try {
      await deletePlant(id);
      router.replace("/(tabs)/spaces");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete plant.");
    } finally {
      pending.current = false;
      setDeleting(false);
    }
  };
  if (!confirming)
    return <Action label="Delete plant" onPress={() => setConfirming(true)} />;
  return (
    <View style={ui.card}>
      <Notice>
        Delete {name} permanently? Its saved identifications and AI analyses
        will also be deleted. This cannot be undone.
      </Notice>
      {error && <Notice>{error}</Notice>}
      <Action
        label={deleting ? "Deleting plant..." : "Confirm permanent deletion"}
        disabled={deleting}
        onPress={() => void remove()}
      />
      <Action
        label="Cancel"
        disabled={deleting}
        onPress={() => {
          setConfirming(false);
          setError(null);
        }}
      />
    </View>
  );
}
