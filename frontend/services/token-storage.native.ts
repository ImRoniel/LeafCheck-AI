import * as SecureStore from "expo-secure-store";
import type { TokenStorage } from "./session";
const key = "leafcheck.refresh.v1";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const tokenStorage: TokenStorage = {
  get: () => SecureStore.getItemAsync(key, options),
  set: (value) => SecureStore.setItemAsync(key, value, options),
  remove: () => SecureStore.deleteItemAsync(key, options),
};
