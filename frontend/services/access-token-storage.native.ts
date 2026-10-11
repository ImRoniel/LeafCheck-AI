import * as SecureStore from "expo-secure-store";
import type { TokenStorage } from "./session";
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const accessTokenStorage: TokenStorage = {
  get: () => SecureStore.getItemAsync("access_token", options),
  set: (token) => SecureStore.setItemAsync("access_token", token, options),
  remove: () => SecureStore.deleteItemAsync("access_token", options),
};
