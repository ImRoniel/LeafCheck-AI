import { api, resolveApiBaseUrl } from "@/services/api";
import { createBrowserCoordination } from "@/services/browser-coordination";
import { platformOS } from "@/services/platform";
import { createSessionCoordinator } from "@/services/session";
import { tokenStorage } from "@/services/token-storage";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";

const native = platformOS !== "web";
export const session = createSessionCoordinator(
  tokenStorage,
  native,
  native
    ? {
        run: (work) => work(),
        broadcastLogout() {},
        listenLogout: () => () => {},
      }
    : createBrowserCoordination(
        resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL, platformOS),
      ),
);
session.bind(api);
api.bindSession(session);
function useSession() {
  const state = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  return {
    ...state,
    isLoading: state.status === "restoring",
    isAuthenticating: state.status === "authenticating",
    isGuest: state.status === "guest",
    login: session.login,
    register: session.register,
    logout: session.logout,
    retryRestore: session.restore,
    enterGuest: session.enterGuest,
    leaveGuest: session.leaveGuest,
  };
}
const Context = createContext<ReturnType<typeof useSession> | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const value = useSession();
  useEffect(() => {
    const stop = session.start();
    void session.restore();
    return stop;
  }, []);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider missing");
  return value;
}
