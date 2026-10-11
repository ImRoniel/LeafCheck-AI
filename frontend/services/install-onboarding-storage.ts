import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IntroStorage } from './install-onboarding-store';

const key = '@leafcheck_onboarding_complete';
/** Non-secret UX state shared by Expo Go, native builds and web. */
export const introStorage: IntroStorage = {
  read: () => AsyncStorage.getItem(key),
  write: (record) => AsyncStorage.setItem(key, record),
};
