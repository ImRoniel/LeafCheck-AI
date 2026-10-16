import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { INVALID_OTP_MESSAGE, OTP_RESEND_MS, otpFlow } from "@/services/email-otp";
import { asApiError } from "@/services/errors";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";

export default function OtpVerification() {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; type?: string; message?: string }>();
  const pending = auth.pendingVerification;
  const flow = otpFlow(params, pending);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  const initialDeadline = useRef(Date.now() + OTP_RESEND_MS);
  const deadline = auth.otpResendAt ?? initialDeadline.current;
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const submitting = useRef(false);
  useEffect(() => {
    if (flow && !pending && auth.status !== "authenticated") {
      try { auth.resumeVerification(flow); }
      catch (e) { setError(e instanceof Error ? e.message : "Request a new code to continue."); }
    }
  }, [flow?.email, flow?.type, pending, auth.status, auth.resumeVerification]);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => tick(value => value + 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, deadline]);
  const back = () => { auth.cancelVerification(); router.replace("/login"); };
  const submit = async (resend = false) => {
    if (submitting.current || !flow || !pending || (resend && remaining > 0)) return;
    if (!resend && !/^\d{8}$/.test(code)) { setError("Enter the eight-digit code from your email."); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (resend) { await auth.resendOtp(flow); setCode(""); }
      else { await auth.verifyOtp(code, flow); setCode(""); }
    } catch (e) {
      const failure = asApiError(e);
      setError(!resend && [400, 401, 403].includes(failure.status ?? 0) ? INVALID_OTP_MESSAGE : failure.message);
    }
    finally { submitting.current = false; setBusy(false); }
  };
  if (auth.status === "authenticated") return <Redirect href="/(tabs)" />;
  return <AuthLayout title={flow?.type === "signup" ? "Verify your email" : "Login with email code"}
    description={flow ? `Enter the 8-digit code sent to ${flow.email}` : "Request a new code to continue."} onBack={back}>
    {flow ? <>
      <Text style={authStyles.note}>{`We sent an 8-digit code to ${flow.email}`}</Text>
      <CustomTextInput label="Email code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8}
        autoComplete="one-time-code" editable={!busy} onSubmitEditing={() => void submit()} />
      {(error || auth.error) && <Notice>{error || auth.error}</Notice>}
      <AuthButton title="Verify code" loading={busy} disabled={!pending} onPress={() => void submit()} />
      <AuthButton title={remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"} disabled={busy || remaining > 0}
        onPress={() => void submit(true)} />
    </> : <>
      <Notice>Request a new code to continue.</Notice>
      <AuthButton title="Return to login" onPress={back} />
    </>}
  </AuthLayout>;
}
