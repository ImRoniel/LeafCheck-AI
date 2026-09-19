import { CollectionState } from '@/components/plant-list';
import { Action, Notice, Screen, ui } from '@/components/screen';
import { useAppData } from '@/context/app-data';
import { useSpaces } from '@/context/spaces';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';
export default function Spaces() { const { spaces, plantsBySpace, backgrounds } = useSpaces(); const data = useAppData(); const router = useRouter(); return <Screen title={'MY\nSPACES'} refresh={() => void data.refresh()} loading={data.loading}><Notice>Read-only locations derived from the API plant collection. These are not separate server-side spaces.</Notice><CollectionState />{spaces.map(space => <Pressable accessibilityRole="button" key={space} style={[ui.card, { backgroundColor: backgrounds[space], minHeight: 150 }]} onPress={() => router.push({ pathname: '/(tabs)/space-detail', params: { space } })}><Ionicons name="leaf-outline" size={42} color="#278448" /><Text style={ui.heading}>{space}</Text><Text style={ui.text}>{plantsBySpace[space].length} plants</Text></Pressable>)}<Action label="Create space — unavailable" disabled /><Action label="Create plant — unavailable" disabled /><Action label="Archives" onPress={() => router.push('/archives')} /></Screen>; }
