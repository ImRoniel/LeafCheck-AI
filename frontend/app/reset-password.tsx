import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { api } from "@/services/api";
import { emailAddress, OTP_RESEND_MS, resendDeadline } from "@/services/email-otp";
import { asApiError } from "@/services/errors";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text } from "react-native";

export default function ResetPassword() {
  const params = useLocalSearchParams<{ email?: string; type?: string; resendAt?: string }>();
  const email = emailAddress(params.email);
  const validContext = !!email && (params.type === undefined || params.type === "recovery");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [operation, setOperation] = useState<"reset" | "resend" | null>(null);
  const busy = operation !== null;
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const routeDeadline = typeof params.resendAt === "string" ? Number(params.resendAt) : NaN;
  const [deadline, setDeadline] = useState(Number.isFinite(routeDeadline) && routeDeadline > 0 ? routeDeadline : Date.now() + OTP_RESEND_MS);
  const [, tick] = useState(0);
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const submitting = useRef(false);
  useEffect(() => {
    if (remaining <= 0 || done) return;
    const timer = setTimeout(() => tick(value => value + 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, deadline, done]);
  const requestCode = () => router.replace({ pathname: "/forgot-password", params: { email: email ?? "" } });
  const submit = async () => {
    if (submitting.current) return;
    if (!validContext || !email || !/^\d{8}$/.test(code)) { setError("Enter the eight-digit recovery code from your email."); return; }
    if ([...password].length < 8 || [...password].length > 128) { setError("Password must contain 8–128 characters."); return; }
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    submitting.current = true;
    setOperation("reset");
    setError(null);
    setNotice(null);
    try {
      await api.resetPassword({ email, code, newPassword: password });
      setCode(""); setPassword(""); setConfirmation(""); setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to reset your password"); }
    finally { submitting.current = false; setOperation(null); }
  };
  const resend = async () => {
    if (submitting.current || !validContext || !email || remaining > 0) return;
    submitting.current = true;
    setOperation("resend"); setError(null); setNotice(null);
    try {
      const response = await api.forgotPassword({ email });
      const next = resendDeadline(response.resendAfter);
      setDeadline(next);
      router.setParams({ resendAt: String(next) });
      setCode("");
      setNotice("If an eligible account exists, a new recovery code has been sent.");
    } catch (e) {
      const failure = asApiError(e);
      if (failure.status === 429) {
        const next = Date.now() + OTP_RESEND_MS;
        setDeadline(next);
        router.setParams({ resendAt: String(next) });
      }
      setError(failure.message);
    } finally { submitting.current = false; setOperation(null); }
  };
  return <AuthLayout recovery title={done ? "Password reset" : "Reset password"}
    description={done ? "Your password has been changed. Sign in with your new password." : "If an eligible account exists, a recovery code was sent. Codes can be used once."}
    onBack={busy ? undefined : () => router.replace({ pathname: "/login", params: { email: email ?? "" } })}>
    {done ? <AuthButton title="Return to login" onPress={() => router.replace({ pathname: "/login", params: { email: email ?? "" } })} /> : !validContext ? <>
      <Notice>Request a recovery code first to reset your password.</Notice>
      <AuthButton title="Request a recovery code" onPress={requestCode} />
    </> : <>
      <Text style={authStyles.destinationEmail}>{email}</Text>
      <CustomTextInput label="Recovery code" value={code} onChangeText={setCode} keyboardType="number-pad"
        maxLength={8} autoComplete="one-time-code" editable={!busy} />
      <CustomTextInput label="New password" value={password} onChangeText={setPassword} secureTextEntry={!visible}
        onToggleVisibility={() => setVisible(!visible)} autoComplete="new-password" autoCorrect={false} editable={!busy} />
      <CustomTextInput label="Confirm new password" value={confirmation} onChangeText={setConfirmation}
        secureTextEntry={!visible} autoComplete="new-password" autoCorrect={false} editable={!busy}
        onSubmitEditing={() => void submit()} />
      {error && <Notice>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      <AuthButton title={operation === "reset" ? "Resetting password..." : "Reset password"} loading={operation === "reset"}
        disabled={busy || !/^\d{8}$/.test(code)} onPress={() => void submit()} />
      <AuthButton title={operation === "resend" ? "Resending code..." : remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"}
        loading={operation === "resend"} variant="secondary" disabled={busy || remaining > 0} onPress={() => void resend()} />
      <Pressable accessibilityRole="link" disabled={busy} style={authStyles.linkButton} onPress={requestCode}>
        <Text style={authStyles.link}>Use a different email</Text>
      </Pressable>
    </>}
  </AuthLayout>;
}
