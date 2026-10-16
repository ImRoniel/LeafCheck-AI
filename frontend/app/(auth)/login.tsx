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
export default function Login() {
  const auth = useAuth();
  const router = useRouter();
  const capabilities = useAuthCapabilities();
  const params = useLocalSearchParams<{ email?: string }>();
  const pending = auth.pendingVerification;
  const attemptedHandoff = useRef<string | null>(null);
  const [email, setEmail] = useState(emailAddress(params.email) ?? "");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [operation, setOperation] = useState<"password" | "code" | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
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
  const loginWithCode = async () => {
    if (submitting.current || pending) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    submitting.current = true;
    setOperation("code");
    setError(null);
    try {
      await auth.requestLoginOtp({ email: email.trim().toLowerCase() });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to send a code"); }
    finally { submitting.current = false; setOperation(null); }
  };
  const submit = async () => {
    if (submitting.current || pending) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    submitting.current = true;
    setOperation("password");
    setError(null);
    try {
      await auth.login({ email: email.trim().toLowerCase(), password });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
    } finally {
      submitting.current = false;
      setOperation(null);
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
      title="Welcome to LeafCheck AI"
      description="Sign in to your private collection."
    >
      <View style={{ gap: 14 }}>
        {(error || auth.error) && <Notice>{error || auth.error}</Notice>}
        <CustomTextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          autoCorrect={false}
          editable={!busy}
        />
        <CustomTextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!visible}
          onToggleVisibility={() => setVisible(!visible)}
          autoComplete="current-password"
          autoCorrect={false}
          editable={!busy}
          onSubmitEditing={() => void submit()}
        />
        <AuthButton
          title={operation === "password" ? "Signing in..." : "Sign in"}
          loading={operation === "password"}
          disabled={busy}
          onPress={() => void submit()}
        />
        {capabilities.passwordRecovery && <Pressable accessibilityRole="link" disabled={busy}
          onPress={() => router.push({ pathname: "/forgot-password", params: { email: email.trim().toLowerCase() } })} style={authStyles.linkButton}>
          <Text style={authStyles.link}>Forgot password?</Text>
        </Pressable>}
        {capabilities.emailOtp && <AuthButton title={operation === "code" ? "Sending code..." : "Login with email code"}
          loading={operation === "code"} disabled={busy}
          onPress={() => void loginWithCode()} />}
        {capabilities.status === "loading" && <Notice>Loading email sign-in options...</Notice>}
        {capabilities.status === "error" && <>
          <Notice>{capabilities.error}</Notice>
          <AuthButton title="Retry email options" variant="secondary" disabled={busy} onPress={capabilities.retry} />
        </>}
        {capabilities.status === "ready" && !capabilities.emailOtp && <Notice>Email code sign-in is unavailable.</Notice>}
        {capabilities.status === "ready" && !capabilities.passwordRecovery && <Notice>Password recovery is unavailable.</Notice>}
      </View>
      <View style={authStyles.footer}>
        <Text style={authStyles.footerText}>New to LeafCheck?</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => router.push("/register")}
          style={[authStyles.linkButton, busy && { opacity: 0.45 }]}
        >
          <Text style={authStyles.link}>Create an account</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="link"
        disabled={busy}
        onPress={() => router.push("/terms")}
        style={[authStyles.linkButton, { alignSelf: "center" }]}
      >
        <Text style={authStyles.link}>Terms and limitations</Text>
      </Pressable>
    </AuthLayout>
  );
}
