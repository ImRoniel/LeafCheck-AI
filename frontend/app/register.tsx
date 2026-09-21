import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { Notice } from "@/components/screen";
import { useAuth } from "@/context/auth";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function Register() {
  const router = useRouter();
  const auth = useAuth();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const handleRegister = async () => {
    if (submitting.current) return;
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

  return (
    <AuthLayout
      compact
      title="Create your account"
      description="A fresh start for you and your plants."
      onBack={() => router.replace("/login")}
    >
      <CustomTextInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="Enter your email"
        keyboardType="email-address"
        autoCorrect={false}
        autoComplete="email"
        returnKeyType="next"
      />
      <CustomTextInput
        label="First name"
        value={firstName}
        onChangeText={setFirstName}
        placeholder="Enter your first name"
        autoCapitalize="words"
        autoComplete="given-name"
        returnKeyType="next"
      />
      <CustomTextInput
        label="Last name"
        value={lastName}
        onChangeText={setLastName}
        placeholder="Enter your last name"
        autoCapitalize="words"
        autoComplete="family-name"
        returnKeyType="next"
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
        onPress={() => router.push("/terms")}
        style={authStyles.linkButton}
      >
        <Text style={authStyles.link}>Read terms and limitations</Text>
      </Pressable>
      <AuthButton
        title={busy ? "Creating account…" : "Create account"}
        disabled={busy}
        onPress={() => void handleRegister()}
      />
      <View style={authStyles.footer}>
        <Text style={authStyles.footerText}>Already have an account?</Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.replace("/login")}
          style={authStyles.linkButton}
        >
          <Text style={authStyles.link}>Log in</Text>
        </Pressable>
      </View>
    </AuthLayout>
  );
}
