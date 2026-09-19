import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
export function BottomNav() {
  const r = useRouter(), path = usePathname(), insets = useSafeAreaInsets();
  const items = [['home-outline', 'Home', '/'], ['search-outline', 'Search', '/search'], ['leaf-outline', 'Spaces', '/spaces'], ['notifications-outline', 'Notifications', '/notifications']] as const;
  return <View style={[s.outer, { bottom: insets.bottom + 12 }]}><View style={s.bar}>{items.map(([icon, label, route]) => <Pressable key={route} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: path === route }} style={s.item} onPress={() => { if (route === '/') r.navigate('/(tabs)'); else if (route === '/search') r.navigate('/(tabs)/search'); else if (route === '/spaces') r.navigate('/(tabs)/spaces'); else r.navigate('/(tabs)/notifications'); }}><Ionicons name={icon} size={24} color={path === route ? '#20B64D' : '#333'} /></Pressable>)}</View><Pressable accessibilityRole="tab" accessibilityLabel="Camera" style={s.cam} onPress={() => r.navigate('/(tabs)/camera')}><Ionicons name="camera-outline" size={26} color="#278448" /></Pressable></View>;
}
const s = StyleSheet.create({ outer: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 }, bar: { height: 58, width: 235, borderRadius: 29, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', shadowColor: '#000', shadowOpacity: .15, shadowRadius: 6, elevation: 5 }, item: { width: 48, height: 50, alignItems: 'center', justifyContent: 'center' }, cam: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: .15, shadowRadius: 6, elevation: 5 } });
