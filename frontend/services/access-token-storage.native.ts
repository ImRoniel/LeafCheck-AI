import * as SecureStore from "expo-secure-store";
import type { TokenStorage } from "./session";
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
// Cleanup only: access tokens exist exclusively in the session coordinator.
export const accessTokenStorage: Pick<TokenStorage, "remove"> = {
  remove: () => SecureStore.deleteItemAsync("access_token", options),
};
