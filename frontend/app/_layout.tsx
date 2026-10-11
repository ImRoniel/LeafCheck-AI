import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Action, Notice, Screen } from "@/components/screen";
import { AppDataProvider } from "@/context/app-data";
import { AuthProvider, useAuth } from "@/context/auth";
import { LocalStateProvider, useLocalState } from "@/context/local-state";
import { InstallOnboardingProvider, useInstallOnboarding } from "@/context/install-onboarding";
import Splash from "./splash";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform } from "react-native";
function Routes({ hasToken }: { hasToken: boolean }) {
  const auth = useAuth();
  const local = useLocalState();
  const reducedMotion = useReducedMotion();
  if (auth.isLoading) return <Splash />;
  if (auth.status === "error")
    return (
      <Screen title="Session unavailable">
        <Notice>{auth.error}</Notice>
        <Action
          label="Retry connection"
          onPress={() => void auth.retryRestore()}
        />
        <Action label="Return to login" onPress={() => void auth.logout().catch(() => {})} />
      </Screen>
    );
  const authenticated = hasToken;
  const active = authenticated;
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
  return (
    <Stack
      initialRouteName={active ? "(tabs)" : "login"}
      screenOptions={{
        headerShown: false,
        animation: reducedMotion ? "none" : "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Protected guard={active}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={active}>
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
      <Stack.Protected guard={authenticated}>
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
function AccountTree({ hasToken }: { hasToken: boolean }) {
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
        <Routes hasToken={hasToken} />
      </AppDataProvider>
    </LocalStateProvider>
  );
}
/** The intro tree is outside account-keyed providers, so restore cannot reset slides. */
function StartupTree() {
  const intro = useInstallOnboarding();
  const auth = useAuth();
  const reducedMotion = useReducedMotion();
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const gateError = useRef<string | null>(null);
  const latest = useRef({ phase: intro.phase, status: auth.status });
  latest.current = { phase: intro.phase, status: auth.status };
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      AsyncStorage.getItem("@leafcheck_onboarding_complete"),
      Platform.OS === "web" ? Promise.resolve(null) : SecureStore.getItemAsync("access_token"),
    ]).then(([flag, token]) => {
      if (!mounted) return;
      setHasOnboarded(latest.current.phase === "completed" || flag === "true");
      setHasToken(latest.current.status === "authenticated" ||
        (latest.current.status !== "signedOut" && latest.current.status !== "guest" && Boolean(token)));
    }).catch(() => {
      if (mounted) {
        gateError.current = "Startup storage could not be read. Please restart the app.";
        setHasToken(false);
      }
    });
    return () => { mounted = false; };
  }, []);
  // Completion is published only after AsyncStorage has durably written true.
  useEffect(() => {
    if (intro.phase === "completed") setHasOnboarded(true);
  }, [intro.phase]);
  // Login/logout and expired credentials update the gate during this app session.
  useEffect(() => {
    if (auth.status === "authenticated") setHasToken(true);
    else if (auth.status === "signedOut") setHasToken(false);
  }, [auth.status]);
  const [splashReady, setSplashReady] = useState(false);
  // This timer belongs to the startup tree, not the flag read or an account tree.
  // It runs once while both storage and session restoration proceed in parallel.
  useEffect(() => {
    const timer = setTimeout(() => setSplashReady(true), 2000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (splashReady && intro.phase === "splash") intro.finishSplash();
  }, [splashReady, intro.phase, intro.finishSplash]);
  if (gateError.current) return <Screen title="Startup unavailable"><Notice>{gateError.current}</Notice></Screen>;
  if (hasOnboarded === null || hasToken === null || !splashReady || intro.phase === "loading" || (intro.phase === "completed" && auth.isLoading)) return <Splash />;
  if (intro.phase === "error") return (
    <Screen title="Introductory setup unavailable">
      <Notice>{intro.error}</Notice>
      <Action label="Retry local storage" onPress={() => void intro.retry()} />
    </Screen>
  );
  // State 1: no AsyncStorage flag => onboarding, regardless of token presence.
  if (!hasOnboarded || intro.phase !== "completed") return (
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
  // State 2: completed with no token => Login. State 3: token => Dashboard.
  const tokenAvailable = auth.status === "authenticated" ||
    (auth.status !== "signedOut" && auth.status !== "guest" && hasToken);
  return <AccountTree hasToken={tokenAvailable} />;
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
