import { Action, Notice, Screen, ui } from '@/components/screen';
import { useAppData } from '@/context/app-data';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
export default function Profile() { const data = useAppData(); const router = useRouter(); return <Screen title="Profile" back><View style={ui.card}><Ionicons name="person-circle-outline" size={96} color="#278448" /><Text style={ui.title}>Guest</Text><Text style={ui.text}>Local guest session · no account or email</Text></View><Notice>Authentication and profile changes are unavailable. Continuing as Guest does not authenticate with the server.</Notice><Action label="Edit profile — unavailable" disabled /><Action label="Device settings" onPress={() => router.push('/settings')} /><Action label="End guest session" onPress={data.leaveGuest} /></Screen>; }
