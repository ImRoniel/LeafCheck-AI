import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { useAuthCapabilities } from "@/hooks/use-auth-capabilities";
import { otpRoute } from "@/services/email-otp";
import { Redirect, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
export default function Login() {
  const auth = useAuth();
  const router = useRouter();
  const capabilities = useAuthCapabilities();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const loginWithCode = async () => {
    if (submitting.current) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Enter a valid email address."); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await auth.requestLoginOtp({ email: email.trim().toLowerCase() });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to send a code"); }
    finally { submitting.current = false; setBusy(false); }
  };
  const submit = async () => {
    if (submitting.current) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await auth.login({ email: email.trim().toLowerCase(), password });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  if (auth.pendingVerification) return <Redirect href={otpRoute(auth.pendingVerification)} />;
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
          title={busy ? "Signing in..." : "Sign in"}
          loading={busy}
          onPress={() => void submit()}
        />
        {capabilities.passwordRecovery && <Pressable accessibilityRole="link" disabled={busy}
          onPress={() => router.push("/forgot-password")} style={authStyles.linkButton}>
          <Text style={authStyles.link}>Forgot password?</Text>
        </Pressable>}
        {capabilities.emailOtp && <AuthButton title="Login with email code" disabled={busy}
          onPress={() => void loginWithCode()} />}
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
        onPress={() => router.push("/terms")}
        style={[authStyles.linkButton, { alignSelf: "center" }]}
      >
        <Text style={authStyles.link}>Terms and limitations</Text>
      </Pressable>
    </AuthLayout>
  );
}
