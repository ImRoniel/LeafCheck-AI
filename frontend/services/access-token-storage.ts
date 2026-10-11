import type { TokenStorage } from "./session";
// SecureStore is native-only; browser sessions use the existing HttpOnly cookie.
export const accessTokenStorage: TokenStorage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
};
