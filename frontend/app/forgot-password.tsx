import { AuthButton } from "@/components/auth-button";
import { AuthLayout, authStyles } from "@/components/auth-layout";
import { CustomTextInput } from "@/components/custom-text-input";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const handleSendOTP = () => {};
  const backToLogin = () => router.replace("/login");

  return (
    <AuthLayout recovery title="Forgot password?" description="Enter the email linked to your account to start resetting your password." onBack={backToLogin}>
      <CustomTextInput label="Email address" value={email} onChangeText={setEmail} placeholder="Enter your email address" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" returnKeyType="done" onSubmitEditing={handleSendOTP} />
      <Text style={authStyles.note}>Password recovery is unavailable. No email or code will be sent.</Text>
      <AuthButton title="Send OTP unavailable" disabled onPress={handleSendOTP} />
      <View style={authStyles.footer}>
        <Text style={authStyles.footerText}>Remember your password?</Text>
        <Pressable accessibilityRole="link" onPress={backToLogin} style={authStyles.linkButton}><Text style={authStyles.link}>Log in</Text></Pressable>
      </View>
    </AuthLayout>
  );
}
