import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, StyleSheet, Text, TouchableOpacity } from "react-native";

function AuthLoadingMessage() {
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: Platform.OS !== "web",
    });
    const timer = setTimeout(() => {
      setVisible(true);
      animation.start();
    }, 2000);

    return () => {
      clearTimeout(timer);
      animation.stop();
    };
  }, [opacity]);

  return visible ? (
    <Animated.Text accessibilityLiveRegion="polite" style={[styles.waitMessage, { opacity }]}>
      Please wait...
    </Animated.Text>
  ) : null;
}

export function AuthButton({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  loading?: boolean;
}) {
  const isDisabled = disabled || loading;
  const buttonStyle = [
    styles.button,
    variant === "primary" ? styles.primaryButton : styles.secondaryButton,
    isDisabled && styles.disabledButton,
  ];

  return (
    <>
      <TouchableOpacity
        style={buttonStyle}
        onPress={isDisabled ? undefined : onPress}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
      >
        {loading && <ActivityIndicator size="small" color={variant === "secondary" ? "#245C36" : "#FFFFFF"} />}
        <Text style={[styles.buttonText, variant === "secondary" && { color: "#245C36" }]}>{title}</Text>
      </TouchableOpacity>
      {loading && <AuthLoadingMessage />}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: "100%",
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 25,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    backgroundColor: "#278448",
  },
  secondaryButton: {
    backgroundColor: "#EAF2E8",
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    color: "#FFFFFF",
  },
  waitMessage: {
    marginTop: 8,
    color: "#66746A",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
});
