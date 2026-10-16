import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { INVALID_OTP_MESSAGE, OTP_RESEND_MS, otpFlow, otpSource } from "@/services/email-otp";
import { asApiError } from "@/services/errors";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, Text } from "react-native";

export default function OtpVerification() {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; type?: string; message?: string }>();
  const pending = auth.pendingVerification;
  const flow = otpFlow(params, pending);
  const [code, setCode] = useState("");
  const [operation, setOperation] = useState<"verify" | "resend" | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  const source = flow ?? otpFlow({}, pending);
  const back = useCallback(() => {
    auth.cancelVerification();
    router.replace(otpSource(source));
  }, [auth.cancelVerification, router, source]);
  useEffect(() => {
    if (auth.status === "authenticated") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; });
    return () => subscription.remove();
  }, [auth.status, back]);
  const submit = async (resend = false) => {
    if (submitting.current || !flow || !pending || (resend && remaining > 0)) return;
    if (!resend && !/^\d{8}$/.test(code)) { setError("Enter the eight-digit code from your email."); return; }
    submitting.current = true;
    setOperation(resend ? "resend" : "verify");
    setError(null);
    setNotice(null);
    try {
      if (resend) { await auth.resendOtp(flow); setCode(""); setNotice("A new code has been sent. Check your email."); }
      else { await auth.verifyOtp(code, flow); setCode(""); }
    } catch (e) {
      const failure = asApiError(e);
      setError(!resend && [400, 401, 403].includes(failure.status ?? 0) ? INVALID_OTP_MESSAGE : failure.message);
    }
    finally { submitting.current = false; setOperation(null); }
  };
  if (auth.status === "authenticated") return <Redirect href="/(tabs)" />;
  return <AuthLayout title={flow?.type === "signup" ? "Verify your email" : "Login with email code"}
    description={flow ? `Enter the 8-digit code sent to ${flow.email}` : "Request a new code to continue."}
    onBack={back} backLabel={source?.type === "signup" ? "Back to registration" : "Back to log in"}>
    {flow ? <>
      <Text style={authStyles.destinationEmail}>{flow.email}</Text>
      <CustomTextInput label="Email code" value={code} onChangeText={value => { setCode(value); setError(null); }} keyboardType="number-pad" maxLength={8}
        autoComplete="one-time-code" editable={!busy} onSubmitEditing={() => void submit()} />
      {error && <Notice>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <AuthButton title={operation === "verify" ? "Verifying..." : "Verify code"} loading={operation === "verify"}
        disabled={busy || !pending || !/^\d{8}$/.test(code)} onPress={() => void submit()} />
      <AuthButton title={operation === "resend" ? "Resending code..." : remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"}
        loading={operation === "resend"} variant="secondary" disabled={busy || remaining > 0}
        onPress={() => void submit(true)} />
      <Pressable accessibilityRole="link" style={authStyles.linkButton} onPress={back}>
        <Text style={authStyles.link}>Use a different email</Text>
      </Pressable>
    </> : <>
      <Notice>Request a new code to continue.</Notice>
      <AuthButton title={source?.type === "signup" ? "Return to registration" : "Return to login"} onPress={back} />
    </>}
  </AuthLayout>;
}
