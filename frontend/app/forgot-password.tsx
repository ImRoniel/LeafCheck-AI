import { AuthButton } from "@/components/auth-button";
import { AuthLayout } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { api } from "@/services/api";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const submit = async () => {
    if (submitting.current) return;
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError("Enter a valid email address."); return; }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword({ email: address });
      router.push({ pathname: "/reset-password", params: { email: address, type: "recovery" } });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to send a recovery code"); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <AuthLayout title="Forgot password" description="Enter your email to request an eight-digit recovery code."
    onBack={() => router.replace("/login")}>
    <CustomTextInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address"
      autoComplete="email" autoCorrect={false} editable={!busy} onSubmitEditing={() => void submit()} />
    {error && <Notice>{error}</Notice>}
    <AuthButton title="Send recovery code" loading={busy} onPress={() => void submit()} />
  </AuthLayout>;
}
