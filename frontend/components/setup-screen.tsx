import { useAuth } from "@/context/auth";
import { useLocalState } from "@/context/local-state";
import type { SetupStep } from "@/types/local-state";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState, type PropsWithChildren } from "react";
import {
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    type TextInputProps,
} from "react-native";
import { Action, Notice, Screen, ui } from "./screen";

export function useSetupAction() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save setup. Please retry.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function SetupScreen({
  children,
  title,
  subtitle,
  progress,
  back,
  busy,
  error,
}: PropsWithChildren<{
  title: string;
  subtitle: string;
  progress: string;
  back?: SetupStep;
  busy?: boolean;
  error?: string | null;
}>) {
  const local = useLocalState();
  const auth = useAuth();
  const navigation = useSetupAction();
  const disabled = busy || navigation.busy;
  return (
    <Screen>
      <View style={setupStyles.header}>
        <View style={setupStyles.brand}>
          <Ionicons name="leaf" size={23} color="#278448" />
          <Text style={ui.heading}>LeafCheck</Text>
        </View>
        <Text style={ui.note}>{progress}</Text>
      </View>
      <View style={ui.row}>
        {back && (
          <Action
            label="Back"
            disabled={disabled}
            onPress={() => void navigation.run(() => local.goTo(back))}
          />
        )}
        <Action
          label="Skip setup"
          disabled={disabled}
          onPress={() => void navigation.run(local.skip)}
        />
      </View>
      <Text accessibilityRole="header" style={ui.title}>
        {title}
      </Text>
      <Text style={ui.text}>{subtitle}</Text>
      {auth.isGuest && (
        <Notice>
          Guest setup stays on this device. Sign-in uses a separate collection;
          cloud AI scans require an account.
        </Notice>
      )}
      {(error || navigation.error) && (
        <Notice>{error || navigation.error}</Notice>
      )}
      <View
        pointerEvents={disabled ? "none" : "auto"}
        style={setupStyles.content}
      >
        {children}
      </View>
      <Text style={ui.note}>
        Your progress and care preferences are saved on this device.
      </Text>
    </Screen>
  );
}

export function SetupChoice({
  title,
  description,
  selected,
  onPress,
}: {
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[ui.card, setupStyles.choice, selected && setupStyles.selected]}
    >
      <View style={setupStyles.header}>
        <Text style={[ui.heading, { flex: 1 }]}>{title}</Text>
        <Ionicons
          name={selected ? "radio-button-on" : "radio-button-off"}
          size={24}
          color="#278448"
        />
      </View>
      {description && <Text style={ui.text}>{description}</Text>}
    </Pressable>
  );
}

export function SetupField({
  label,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={ui.text}>{label}</Text>
      <TextInput accessibilityLabel={label} style={ui.input} {...props} />
    </View>
  );
}

const setupStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  content: { gap: 16 },
  choice: { borderWidth: 2, borderColor: "#DCE8DC", minHeight: 76 },
  selected: { borderColor: "#278448", backgroundColor: "#EAF5E9" },
});
