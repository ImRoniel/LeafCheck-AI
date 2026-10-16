import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";

export default function OtpVerification() {
  const auth = useAuth();
  const router = useRouter();
  const pending = auth.pendingVerification;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(pending?.resendAfter ?? 60);
  const submitting = useRef(false);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  const back = () => { auth.cancelVerification(); router.replace("/login"); };
  const submit = async (resend = false) => {
    if (submitting.current || !pending || (resend && remaining > 0)) return;
    if (!resend && !/^\d{8}$/.test(code)) { setError("Enter the eight-digit code from your email."); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (resend) { const next = await auth.resendOtp(); setRemaining(next.resendAfter); setCode(""); }
      else { await auth.verifyOtp(code); setCode(""); }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to verify the code"); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <AuthLayout title={pending?.purpose === "registration" ? "Verify your email" : "Login with email code"}
    description="Enter the eight-digit code from your email. Codes can be used once." onBack={back}>
    {pending ? <>
      <Text style={authStyles.note}>{pending.email}</Text>
      <CustomTextInput label="Email code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8}
        autoComplete="one-time-code" editable={!busy} onSubmitEditing={() => void submit()} />
      {(error || auth.error) && <Notice>{error || auth.error}</Notice>}
      <AuthButton title="Verify code" loading={busy} onPress={() => void submit()} />
      <AuthButton title={remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"} disabled={busy || remaining > 0}
        onPress={() => void submit(true)} />
    </> : <>
      <Notice>Request a new code to continue.</Notice>
      <AuthButton title="Return to login" onPress={back} />
    </>}
  </AuthLayout>;
}
