import { AuthLayout } from '@/components/auth-layout';
import { Action, Notice, ui } from '@/components/screen';
import { useRouter } from 'expo-router';
import { TextInput } from 'react-native';

export default function Verification() {
  const router = useRouter();
  return <AuthLayout recovery title="Enter OTP Code" description="Account verification" onBack={() => router.replace('/login')}>
    <Notice>Verification is unavailable in this build. No code has been sent.</Notice>
    <TextInput style={ui.input} editable={false} placeholder="------" accessibilityLabel="Verification code unavailable" />
    <Action label="Verify unavailable" disabled />
    <Action label="Resend unavailable" disabled />
  </AuthLayout>;
}
