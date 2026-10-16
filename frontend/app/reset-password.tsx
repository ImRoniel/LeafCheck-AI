import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { api } from "@/services/api";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Text } from "react-native";

export default function ResetPassword() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current) return;
    if (!email || !/^\d{8}$/.test(code)) { setError("Enter the eight-digit recovery code from your email."); return; }
    if ([...password].length < 8 || [...password].length > 128) { setError("Password must contain 8–128 characters."); return; }
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword({ email, code, newPassword: password });
      setCode(""); setPassword(""); setConfirmation(""); setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to reset your password"); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <AuthLayout title={done ? "Password reset" : "Reset password"}
    description={done ? "Your password has been changed. Sign in with your new password." : "If an eligible account exists, a recovery code was sent. Codes can be used once."}
    onBack={() => router.replace("/login")}>
    {done ? <AuthButton title="Return to login" onPress={() => router.replace("/login")} /> : <>
      <Text style={authStyles.note}>{email ?? "Request a recovery code first."}</Text>
      <CustomTextInput label="Recovery code" value={code} onChangeText={setCode} keyboardType="number-pad"
        maxLength={8} autoComplete="one-time-code" editable={!busy} />
      <CustomTextInput label="New password" value={password} onChangeText={setPassword} secureTextEntry={!visible}
        onToggleVisibility={() => setVisible(!visible)} autoComplete="new-password" autoCorrect={false} editable={!busy} />
      <CustomTextInput label="Confirm new password" value={confirmation} onChangeText={setConfirmation}
        secureTextEntry={!visible} autoComplete="new-password" autoCorrect={false} editable={!busy}
        onSubmitEditing={() => void submit()} />
      {error && <Notice>{error}</Notice>}
      <AuthButton title="Reset password" loading={busy} disabled={!email} onPress={() => void submit()} />
      <AuthButton title="Request another code" disabled={busy} onPress={() => router.replace("/forgot-password")} />
    </>}
  </AuthLayout>;
}
