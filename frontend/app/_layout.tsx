import { Action, Notice, Screen } from "@/components/screen";
import { AppDataProvider } from "@/context/app-data";
import { AuthProvider, useAuth } from "@/context/auth";
import { Stack } from "expo-router";
import { ActivityIndicator } from "react-native";
function Routes() {
  const auth = useAuth();
  if (auth.isLoading)
    return (
      <Screen title="Restoring session">
        <ActivityIndicator accessibilityLabel="Restoring session" />
      </Screen>
    );
  if (auth.status === "error")
    return (
      <Screen title="Session unavailable">
        <Notice>{auth.error}</Notice>
        <Action
          label="Retry connection"
          onPress={() => void auth.retryRestore()}
        />
        <Action label="Continue as guest" onPress={auth.enterGuest} />
      </Screen>
    );
  const authenticated = auth.status === "authenticated";
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={authenticated || auth.isGuest}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" />
      </Stack.Protected>
      <Stack.Protected guard={!authenticated}>
        <Stack.Screen name="login" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="otp-verification" />
        <Stack.Screen name="splash" />
      </Stack.Protected>
      <Stack.Screen name="terms" />
      <Stack.Protected guard={authenticated}>
        <Stack.Screen name="plant-profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="archives" />
        <Stack.Screen name="modal" options={{ presentation: "modal" }} />
      </Stack.Protected>
    </Stack>
  );
}
function AccountTree() {
  const auth = useAuth();
  return (
    <AppDataProvider
      key={
        auth.user
          ? `${auth.generation}:${auth.user.id}`
          : auth.isGuest
            ? "guest"
            : "anonymous"
      }
    >
      <Routes />
    </AppDataProvider>
  );
}
export default function Layout() {
  return (
    <AuthProvider>
      <AccountTree />
    </AuthProvider>
  );
}
