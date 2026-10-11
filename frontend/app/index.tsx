import { useInstallOnboarding } from '@/context/install-onboarding';
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
  if (auth.status === 'authenticated') return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}
