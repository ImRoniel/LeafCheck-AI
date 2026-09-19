import { AuthLayout } from '@/components/auth-layout';
import { Action, Notice } from '@/components/screen';
import { useAppData } from '@/context/app-data';
import { View } from 'react-native';
export default function Login() { const { enterGuest } = useAppData(); return <AuthLayout title="Welcome to LeafCheck AI" description="Explore your plants, capture a leaf, and understand its growing conditions."><View style={{ gap: 14 }}><Notice>Accounts are not available in this build. Guest entry is local only and does not sign you in to the API.</Notice><Action label="Continue as Guest" onPress={enterGuest} /><Action label="Sign in — unavailable" disabled /><Action label="Register — unavailable" disabled /><Action label="Reset password — unavailable" disabled /></View></AuthLayout>; }
