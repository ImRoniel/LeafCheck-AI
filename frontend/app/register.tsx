import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { useAuthCapabilities } from "@/hooks/use-auth-capabilities";
import { codeSentMessage, emailAddress, otpFlow, otpRoute, otpSource } from "@/services/email-otp";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function Register() {
  const router = useRouter();
  const auth = useAuth();
  const capabilities = useAuthCapabilities();
  const params = useLocalSearchParams<{ email?: string }>();
  const pending = auth.pendingVerification;
  const attemptedHandoff = useRef<string | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState(emailAddress(params.email) ?? "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const openVerification = useCallback(() => {
    if (!pending) return;
    try { router.replace(otpRoute(pending)); }
    catch { setError("Your code was sent. Tap Continue to verification to enter it."); }
  }, [pending, router]);
  useEffect(() => {
    if (!pending) { attemptedHandoff.current = null; return; }
    const key = `${pending.purpose}:${pending.email}`;
    if (attemptedHandoff.current === key) return;
    attemptedHandoff.current = key;
    openVerification();
  }, [pending, openVerification]);
  const handleRegister = async () => {
    if (submitting.current || pending) return;
    const name = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    if (!accepted) {
      setError("Accept the terms and limitations to continue.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if ([...password].length < 8 || [...password].length > 128) {
      setError("Password must contain 8–128 characters. Spaces are preserved.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || name.length > 100) {
      setError("Enter a valid email and a name of at most 100 characters.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await auth.register({
        email: email.trim().toLowerCase(),
        password,
        ...(name ? { name } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  if (pending) return <AuthLayout title="Check your email" description={codeSentMessage(pending.email)}
    backLabel={pending.purpose === "registration" ? "Back to registration" : "Back to log in"}
    onBack={() => { auth.cancelVerification(); router.replace(otpSource(otpFlow({}, pending))); }}>
    <Text accessibilityLiveRegion="polite" style={authStyles.note}>Continue to enter your code and finish signing in.</Text>
    {error && <Notice>{error}</Notice>}
    <AuthButton title="Continue to verification" onPress={openVerification} />
  </AuthLayout>;
  return (
    <AuthLayout
      compact
      title="Create your account"
      description={capabilities.emailOtp
        ? "We'll email an eight-digit code to verify your account."
        : "A fresh start for you and your plants."}
      onBack={busy ? undefined : () => router.replace("/login")}
    >
      {capabilities.status === "loading" && <Notice>Checking email verification availability...</Notice>}
      {capabilities.status === "error" && <>
        <Notice>{capabilities.error}</Notice>
        <AuthButton title="Retry email options" variant="secondary" disabled={busy} onPress={capabilities.retry} />
      </>}
      {capabilities.status === "ready" && !capabilities.emailOtp && <Notice>Email verification codes are unavailable for the current sign-up method.</Notice>}
      <CustomTextInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="Enter your email"
        keyboardType="email-address"
        autoCorrect={false}
        autoComplete="email"
        returnKeyType="next"
        editable={!busy}
      />
      <CustomTextInput
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="Enter your first name"
        autoCapitalize="words"
        autoComplete="given-name"
        returnKeyType="next"
        editable={!busy}
      />
      <CustomTextInput
        label="Last name"
        value={lastName}
        onChangeText={setLastName}
        placeholder="Enter your last name"
        autoCapitalize="words"
        autoComplete="family-name"
        returnKeyType="next"
        editable={!busy}
      />
      <CustomTextInput
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Create a password"
        secureTextEntry={!showPassword}
        onToggleVisibility={() => setShowPassword((value) => !value)}
        autoCorrect={false}
        autoComplete="new-password"
        returnKeyType="next"
        editable={!busy}
      />
      <CustomTextInput
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Re-enter your password"
        secureTextEntry={!showConfirmPassword}
        onToggleVisibility={() => setShowConfirmPassword((value) => !value)}
        autoCorrect={false}
        autoComplete="new-password"
        returnKeyType="done"
        editable={!busy}
        onSubmitEditing={handleRegister}
      />
      {(error || auth.error) && <Notice>{error || auth.error}</Notice>}
      <Text style={authStyles.note}>
        Use 8–128 characters. Password spaces are never removed.
      </Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        disabled={busy}
        onPress={() => setAccepted(!accepted)}
        style={authStyles.linkButton}
      >
        <Text style={authStyles.link}>
          {accepted ? "☑" : "☐"} I accept the terms and limitations
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        disabled={busy}
        onPress={() => router.push("/terms")}
        style={authStyles.linkButton}
      >
        <Text style={authStyles.link}>Read terms and limitations</Text>
      </Pressable>
      <AuthButton
        title={busy ? "Creating account..." : "Create account"}
        loading={busy}
        onPress={() => void handleRegister()}
      />
      <View style={authStyles.footer}>
        <Text style={authStyles.footerText}>Already have an account?</Text>
        <Pressable
          accessibilityRole="link"
          disabled={busy}
          onPress={() => router.replace("/login")}
          style={authStyles.linkButton}
        >
          <Text style={authStyles.link}>Log in</Text>
        </Pressable>
      </View>
    </AuthLayout>
  );
}
