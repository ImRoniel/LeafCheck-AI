import { AppDataProvider, useAppData } from '@/context/app-data';
import { Stack } from 'expo-router';
function Routes() { const { guest } = useAppData(); return <Stack screenOptions={{ headerShown: false }}>
  <Stack.Protected guard={!guest}><Stack.Screen name="onboarding" /><Stack.Screen name="login" /></Stack.Protected>
  <Stack.Protected guard={guest}><Stack.Screen name="(tabs)" /><Stack.Screen name="plant-profile" /><Stack.Screen name="profile" /><Stack.Screen name="settings" /><Stack.Screen name="archives" /></Stack.Protected>
</Stack>; }
export default function Layout() { return <AppDataProvider><Routes /></AppDataProvider>; }
