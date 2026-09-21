import { Action, Notice, Screen, ui } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
export default function Profile() {
  const auth = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await auth.logout();
    } catch {
      /* Session-wide error is shown on sign-in. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Profile" back>
      <View style={ui.card}>
        <Text style={ui.title}>
          {auth.user?.name || (auth.isGuest ? "Guest" : "Your account")}
        </Text>
        <Text style={ui.text}>
          {auth.user?.email || "Local exploration only — no private cloud data"}
        </Text>
      </View>
      {auth.error && <Notice>{auth.error}</Notice>}
      {auth.isGuest ? (
        <>
          <Action label="Sign in" onPress={() => router.push("/login")} />
          <Action
            label="Create account"
            onPress={() => router.push("/register")}
          />
          <Action label="End guest session" onPress={auth.leaveGuest} />
        </>
      ) : (
        <>
          <Action
            label="Device settings"
            onPress={() => router.push("/settings")}
          />
          <Action
            label={busy ? "Signing out…" : "Sign out"}
            disabled={busy}
            onPress={() => void logout()}
          />
        </>
      )}
      <Action
        label="Terms and limitations"
        onPress={() => router.push("/terms")}
      />
    </Screen>
  );
}
