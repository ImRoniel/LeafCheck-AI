import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";

type Props = TextInputProps & {
  label: string;
  onToggleVisibility?: () => void;
};

export function CustomTextInput({ label, onToggleVisibility, style, onFocus, onBlur, secureTextEntry, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, focused && styles.focused]}>
        <TextInput
          autoCapitalize="none"
          placeholderTextColor="#8C9990"
          accessibilityLabel={label}
          {...props}
          secureTextEntry={secureTextEntry}
          style={[styles.input, style]}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        />
        {onToggleVisibility && (
          <Pressable onPress={onToggleVisibility} style={styles.toggle}
            accessibilityRole="button" accessibilityLabel={`${secureTextEntry ? "Show" : "Hide"} ${label.toLowerCase()}`}>
            <Text style={styles.toggleText}>{secureTextEntry ? "Show" : "Hide"}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 18 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: "#36533F", marginBottom: 8, marginLeft: 4 },
  field: { minHeight: 54, borderWidth: 1, borderColor: "#DCE6DA", borderRadius: 25, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", paddingHorizontal: 18 },
  focused: { borderColor: "#278448", backgroundColor: "#F4FAF2" },
  input: { flex: 1, minWidth: 0, paddingVertical: 15, paddingHorizontal: 0, fontSize: 16, color: "#193E27" },
  toggle: { minWidth: 48, minHeight: 44, marginLeft: 8, alignItems: "center", justifyContent: "center" },
  toggleText: { fontSize: 14, fontWeight: "700", color: "#278448" },
});
