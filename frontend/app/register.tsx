import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const handleRegister = () => {};

  return (
    <AuthLayout compact title="Create your account" description="A fresh start for you and your plants." onBack={() => router.replace("/login")}>
      <CustomTextInput label="Email" value={email} onChangeText={setEmail} placeholder="Enter your email" keyboardType="email-address" autoCorrect={false} autoComplete="email" returnKeyType="next" />
      <CustomTextInput label="First name" value={firstName} onChangeText={setFirstName} placeholder="Enter your first name" autoCapitalize="words" autoComplete="given-name" returnKeyType="next" />
      <CustomTextInput label="Last name" value={lastName} onChangeText={setLastName} placeholder="Enter your last name" autoCapitalize="words" autoComplete="family-name" returnKeyType="next" />
      <CustomTextInput label="Password" value={password} onChangeText={setPassword} placeholder="Create a password" secureTextEntry={!showPassword} onToggleVisibility={() => setShowPassword((value) => !value)} autoCorrect={false} autoComplete="new-password" returnKeyType="next" />
      <CustomTextInput label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Re-enter your password" secureTextEntry={!showConfirmPassword} onToggleVisibility={() => setShowConfirmPassword((value) => !value)} autoCorrect={false} autoComplete="new-password" returnKeyType="done" onSubmitEditing={handleRegister} />
      <Text style={authStyles.note}>Registration is unavailable. No account or credentials will be submitted.</Text>
      <AuthButton title="Sign up unavailable" disabled onPress={handleRegister} />
      <View style={authStyles.footer}>
        <Text style={authStyles.footerText}>Already have an account?</Text>
        <Pressable accessibilityRole="link" onPress={() => router.replace("/login")} style={authStyles.linkButton}><Text style={authStyles.link}>Log in</Text></Pressable>
      </View>
    </AuthLayout>
  );
}
