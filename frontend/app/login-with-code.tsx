import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { codeSentMessage, emailAddress, otpRoute } from "@/services/email-otp";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "react-native";

export default function LoginWithCode() {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(emailAddress(params.email) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const attemptedHandoff = useRef<string | null>(null);
  const pending = auth.pendingVerification;
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
  const back = () => { auth.cancelVerification(); router.replace("/login"); };
  const submit = async () => {
    if (submitting.current || pending) return;
    const address = emailAddress(email);
    if (!address) { setError("Enter a valid email address."); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try { await auth.requestLoginOtp({ email: address }); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to send a code. Please try again."); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (pending) return <AuthLayout title="Check your email" description={codeSentMessage(pending.email)} onBack={back}>
    <Text accessibilityLiveRegion="polite" style={authStyles.note}>Continue to enter your code and sign in.</Text>
    {error && <Notice>{error}</Notice>}
    <AuthButton title="Continue to verification" onPress={openVerification} />
  </AuthLayout>;
  return <AuthLayout title="Login with email code" description="We'll email you an 8-digit code to sign in."
    onBack={busy ? undefined : back}>
    <CustomTextInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address"
      autoComplete="email" autoCorrect={false} editable={!busy} returnKeyType="send"
      onSubmitEditing={() => void submit()} />
    {(error || auth.error) && <Notice>{error || auth.error}</Notice>}
    <AuthButton title={busy ? "Sending code..." : "Send code"} loading={busy} onPress={() => void submit()} />
  </AuthLayout>;
}
