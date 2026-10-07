import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { IntroStorage } from './install-onboarding-store';
interface InstallOnboardingModule { read(): Promise<string | null>; write(record: string): Promise<void> }
function moduleOrThrow(): InstallOnboardingModule {
  const module = requireOptionalNativeModule<InstallOnboardingModule>('InstallOnboarding');
  if (!module) throw new Error('Install onboarding requires a native build');
  return module;
}
// Expo Go preview state is isolated from production installation completion.
const previewKey = 'leafcheck.expo-go.install-intro.v1';
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const introStorage: IntroStorage = isExpoGo ? {
  read: () => AsyncStorage.getItem(previewKey),
  write: (record) => AsyncStorage.setItem(previewKey, record),
} : {
  read: () => moduleOrThrow().read(),
  write: (record) => moduleOrThrow().write(record),
};
