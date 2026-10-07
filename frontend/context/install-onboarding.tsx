import { createIntroStore } from '@/services/install-onboarding-store';
import { introStorage } from '@/services/install-onboarding-storage';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';
const Context = createContext<ReturnType<typeof useInstallStore> | null>(null);
function useInstallStore() {
  const [store] = useState(() => createIntroStore(introStorage));
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => { void store.load(); }, [store]);
  return { ...snapshot, retry: store.load, finishSplash: store.finishSplash, complete: store.complete };
}
export function InstallOnboardingProvider({ children }: PropsWithChildren) {
  const value = useInstallStore();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useInstallOnboarding() {
  const value = useContext(Context);
  if (!value) throw new Error('InstallOnboardingProvider missing');
  return value;
}
