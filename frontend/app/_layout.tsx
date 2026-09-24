import { Action, Notice, Screen } from "@/components/screen";
import { AppDataProvider } from "@/context/app-data";
import { AuthProvider, useAuth } from "@/context/auth";
import { LocalStateProvider, useLocalState } from "@/context/local-state";
import { Stack } from "expo-router";
import { ActivityIndicator } from "react-native";
function Routes() {
  const auth = useAuth();
  const local = useLocalState();
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
  const active = authenticated || auth.isGuest;
  if (active && !local.ready)
    return (
      <Screen
        title={
          local.error ? "Local setup unavailable" : "Restoring your garden"
        }
      >
        {local.error ? (
          <>
            <Notice>{local.error}</Notice>
            <Action
              label="Retry local storage"
              onPress={() => void local.retry()}
            />
            <Action
              label="Sign out"
              onPress={() => {
                if (auth.isGuest) auth.leaveGuest();
                else void auth.logout();
              }}
            />
          </>
        ) : (
          <ActivityIndicator accessibilityLabel="Loading local setup" />
        )}
      </Screen>
    );
  const setupRequired = active && local.data.onboarding.status === "pending";
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={setupRequired}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={active && !setupRequired}>
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
      <Stack.Protected guard={authenticated && !setupRequired}>
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
    <LocalStateProvider
      key={
        auth.user
          ? `${auth.generation}:${auth.user.id}`
          : auth.isGuest
            ? "guest"
            : "anonymous"
      }
    >
      <AppDataProvider>
        <Routes />
      </AppDataProvider>
    </LocalStateProvider>
  );
}
export default function Layout() {
  return (
    <AuthProvider>
      <AccountTree />
    </AuthProvider>
  );
}
