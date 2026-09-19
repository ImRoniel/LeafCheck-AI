import { useRouter } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
export function Screen({ children, title, refresh, loading = false, back = false }: PropsWithChildren<{ title?: string; refresh?: () => void; loading?: boolean; back?: boolean }>) {
  const insets = useSafeAreaInsets(); const router = useRouter();
  return <View style={ui.screen}><ScrollView contentContainerStyle={{ paddingTop: insets.top + 20, paddingHorizontal: 22, paddingBottom: insets.bottom + 115, gap: 16 }} refreshControl={refresh ? <RefreshControl refreshing={loading} onRefresh={refresh} /> : undefined}>
    {back && <Action label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />}
    {title && <Text accessibilityRole="header" style={ui.title}>{title}</Text>}{children}
  </ScrollView></View>;
}
export function Action({ label, onPress, disabled = false }: { label: string; onPress?: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[ui.button, disabled && { opacity: 0.45 }]}><Text style={ui.buttonText}>{label}</Text></Pressable>; }
export function Notice({ children }: PropsWithChildren) { return <Text accessibilityLiveRegion="polite" style={ui.note}>{children}</Text>; }
export const ui = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#F8FBF7' }, title: { fontSize: 30, fontWeight: '800', color: '#193E27' }, heading: { fontSize: 20, fontWeight: '700', color: '#193E27' }, text: { color: '#506557', fontSize: 15, lineHeight: 23 }, note: { color: '#6A521D', backgroundColor: '#FFF3CF', padding: 14, borderRadius: 16, lineHeight: 21 }, card: { backgroundColor: '#FFFFFF', borderRadius: 21, padding: 18, gap: 12, borderWidth: 1, borderColor: '#DBE7DA' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, button: { minHeight: 48, borderRadius: 24, backgroundColor: '#278448', padding: 13, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: '#FFFFFF', fontWeight: '700' }, input: { borderWidth: 1, borderColor: '#B3C8B7', borderRadius: 15, padding: 15, color: '#193E27', backgroundColor: '#FFFFFF', fontSize: 16 } });
