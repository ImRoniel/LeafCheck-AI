import { Action, Notice, Screen } from "@/components/screen";
import { AppDataProvider } from "@/context/app-data";
import { AuthProvider, useAuth } from "@/context/auth";
import { LocalStateProvider, useLocalState } from "@/context/local-state";
import { InstallOnboardingProvider, useInstallOnboarding } from "@/context/install-onboarding";
import Splash from "./splash";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Stack, useRootNavigationState, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator } from "react-native";
function Routes() {
  const auth = useAuth();
  const local = useLocalState();
  const router = useRouter();
  const navigation = useRootNavigationState();
  const reducedMotion = useReducedMotion();
  const enteredGuest = useRef(false);
  useEffect(() => {
    if (auth.isGuest && local.ready && navigation?.key && !enteredGuest.current) {
      enteredGuest.current = true;
      router.replace("/(tabs)");
    }
  }, [auth.isGuest, local.ready, navigation?.key, router]);
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
        <Action label="Continue without an account" onPress={auth.enterLocal} />
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
  const setupPending = local.data.onboarding.status === "pending";
  const setupRequired = authenticated && setupPending;
  return (
    <Stack
      initialRouteName={auth.isGuest ? "(tabs)" : authenticated ? setupRequired ? "setup" : "(tabs)" : "login"}
      screenOptions={{
        headerShown: false,
        animation: reducedMotion ? "none" : "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Protected guard={setupRequired || (auth.isGuest && setupPending)}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={active && !setupRequired}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="device-connection" />
      </Stack.Protected>
      <Stack.Protected guard={!authenticated}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="otp-verification" />
      </Stack.Protected>
      <Stack.Protected guard={false}>
        <Stack.Screen name="splash" />
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Screen name="terms" />
      <Stack.Protected guard={authenticated && !setupRequired}>
        <Stack.Screen name="plant-profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="archives" />
        <Stack.Screen name="modal" options={{
          presentation: "modal",
          animation: reducedMotion ? "none" : "slide_from_bottom",
        }} />
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
/** The intro tree is outside account-keyed providers, so restore cannot reset slides. */
function StartupTree() {
  const intro = useInstallOnboarding();
  const reducedMotion = useReducedMotion();
  if (intro.phase === "loading") return <Splash />;
  if (intro.phase === "error") return (
    <Screen title="Introductory setup unavailable">
      <Notice>{intro.error}</Notice>
      <Action label="Retry local storage" onPress={() => void intro.retry()} />
    </Screen>
  );
  if (intro.phase !== "completed") return (
    <Stack initialRouteName="index" screenOptions={{ headerShown: false, animation: reducedMotion ? "none" : "slide_from_right" }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={intro.phase === "splash"}>
        <Stack.Screen name="splash" />
      </Stack.Protected>
      <Stack.Protected guard={intro.phase === "intro"}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      {/* Declare every other root route explicitly: Expo Router auto-adds omitted screens. */}
      <Stack.Protected guard={false}>
        <Stack.Screen name="setup" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="device-connection" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="otp-verification" />
        <Stack.Screen name="terms" />
        <Stack.Screen name="plant-profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="archives" />
        <Stack.Screen name="modal" />
      </Stack.Protected>
    </Stack>
  );
  return <AccountTree />;
}
export default function Layout() {
  return (
    <InstallOnboardingProvider>
      <AuthProvider>
        <StartupTree />
      </AuthProvider>
    </InstallOnboardingProvider>
  );
}
