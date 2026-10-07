import { useInstallOnboarding } from '@/context/install-onboarding';
import { useLocalState } from '@/context/local-state';
import { useAuth } from '@/context/auth';
import { Redirect } from 'expo-router';
export default function Entry() {
  const intro = useInstallOnboarding();
  const auth = useAuth();
  if (intro.phase === 'splash') return <Redirect href="/splash" />;
  if (intro.phase === 'intro') return <Redirect href="/onboarding" />;
  if (intro.phase !== 'completed' || auth.isLoading || auth.status === 'error') return null;
  return <CompletedEntry />;
}

function CompletedEntry() {
  const auth = useAuth();
  const local = useLocalState();
  if (auth.status === 'authenticated' && local.data.onboarding.status === 'pending') return <Redirect href="/setup/experience" />;
  if (auth.status === 'authenticated' || auth.isGuest) return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}
