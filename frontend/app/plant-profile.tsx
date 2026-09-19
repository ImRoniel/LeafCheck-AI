import { PlantTelemetry } from '@/components/plant-telemetry';
import { Action, Notice, Screen, ui } from '@/components/screen';
import { useAppData } from '@/context/app-data';
import { fetchPlant } from '@/services/api';
import type { Plant } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Text, View } from 'react-native';
export default function PlantProfile() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter(); const { devices } = useAppData();
  const [plant, setPlant] = useState<Plant | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [attempt, setAttempt] = useState(0);
  useFocusEffect(useCallback(() => { const controller = new AbortController(); setPlant(null); setLoading(true); setError(null); if (!id) { setError('Missing plant ID'); setLoading(false); return; } fetchPlant(id, { signal: controller.signal }).then(p => { if (!controller.signal.aborted) setPlant(p); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [id, attempt]));
  return <Screen title={plant?.name ?? 'Plant profile'} back refresh={() => setAttempt(n => n + 1)} loading={loading}>{error && <><Notice>{error}</Notice><Action label="Retry plant" onPress={() => setAttempt(n => n + 1)} /></>}{loading && <Notice>Loading plant…</Notice>}{plant && <><View style={[ui.card, { alignItems: 'center' }]}>{plant.imageUrl ? <Image source={{ uri: plant.imageUrl }} style={{ width: '100%', height: 230, borderRadius: 20 }} /> : <Ionicons name="leaf-outline" size={120} color="#278448" />}<Text style={ui.heading}>{plant.species}</Text><Text style={ui.text}>{plant.location || 'Unassigned'} · {plant.healthStatus}</Text><Text style={ui.text}>Last scanned: {plant.lastScannedAt ? new Date(plant.lastScannedAt).toLocaleString() : 'Not recorded'}</Text></View><Action label="Scan this plant" onPress={() => router.push({ pathname: '/(tabs)/camera', params: { plantId: plant.id } })} /><Action label="Local device mapping" onPress={() => router.push({ pathname: '/settings', params: { plantId: plant.id } })} />{devices[plant.id] ? <PlantTelemetry key={devices[plant.id]} deviceId={devices[plant.id]} /> : <Notice>No local device mapping. Image-only scanning remains available.</Notice>}<Action label="Edit / archive plant — unavailable" disabled /></>}</Screen>;
}
