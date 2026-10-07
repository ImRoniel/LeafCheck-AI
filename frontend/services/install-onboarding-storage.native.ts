import { requireOptionalNativeModule } from 'expo-modules-core';
import type { IntroStorage } from './install-onboarding-store';
interface InstallOnboardingModule { read(): Promise<string | null>; write(record: string): Promise<void> }
function moduleOrThrow(): InstallOnboardingModule {
  const module = requireOptionalNativeModule<InstallOnboardingModule>('InstallOnboarding');
  if (!module) throw new Error('Install onboarding requires a native build');
  return module;
}
export const introStorage: IntroStorage = {
  read: () => moduleOrThrow().read(),
  write: (record) => moduleOrThrow().write(record),
};
