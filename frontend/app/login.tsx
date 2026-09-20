import { AuthLayout } from '@/components/auth-layout';
import { Action, Notice } from '@/components/screen';
import { useAppData } from '@/context/app-data';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
export default function Login() { const { enterGuest } = useAppData(); const router = useRouter(); return <AuthLayout title="Welcome to LeafCheck AI" description="Explore your plants, capture a leaf, and understand its growing conditions."><View style={{ gap: 14 }}><Notice>Accounts are not available in this build. Guest entry is local only and does not sign you in to the API.</Notice><Action label="Continue as Guest" onPress={enterGuest} /><Action label="Sign in unavailable" disabled /><Action label="View registration screen (unavailable)" onPress={() => router.push('/register')} /><Action label="View password recovery (unavailable)" onPress={() => router.push('/forgot-password')} /><Action label="Terms and limitations" onPress={() => router.push('/terms')} /></View></AuthLayout>; }
