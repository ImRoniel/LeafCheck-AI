import type { TokenStorage } from "./session";
// Browser refresh credentials are exclusively managed by HttpOnly cookies.
export const tokenStorage: TokenStorage = {
  get: async () => null,
  set: async () => {
    throw new Error("Browser token persistence is forbidden");
  },
  remove: async () => {},
};
