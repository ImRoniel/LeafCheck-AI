import type { TokenStorage } from "./session";
// SecureStore is native-only; browser sessions use the existing HttpOnly cookie.
export const accessTokenStorage: Pick<TokenStorage, "remove"> = {
  remove: async () => {},
};
