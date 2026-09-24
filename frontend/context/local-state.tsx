import {
    createLocalStateStore,
    localStateKey,
} from "@/services/local-state-storage";
import type { LocalState, SetupStep } from "@/types/local-state";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useSyncExternalStore,
    type PropsWithChildren,
} from "react";
import { session, useAuth } from "./auth";

type LocalContextValue = ReturnType<typeof useLocalStore>;
const Context = createContext<LocalContextValue | null>(null);

function useLocalStore() {
  const auth = useAuth();
  const accountId = auth.user?.id ?? null;
  const store = useMemo(
    () => createLocalStateStore(AsyncStorage, localStateKey(accountId)),
    [accountId, auth.generation],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  useEffect(() => {
    void store.load();
  }, [store]);

  const update = async (change: (state: LocalState) => LocalState) => {
    const assertAccount = () => {
      const current = session.snapshot();
      if (
        current.generation !== auth.generation ||
        current.status !== auth.status ||
        (current.user?.id ?? null) !== accountId ||
        !(auth.isGuest || auth.status === "authenticated")
      ) {
        throw new Error(
          "Session changed. Reopen setup in the current account.",
        );
      }
    };
    assertAccount();
    await store.update((state) => {
      assertAccount();
      return change(state);
    });
    assertAccount();
  };

  return {
    ...snapshot,
    update,
    retry: store.load,
    goTo: (step: SetupStep) =>
      update((state) => ({
        ...state,
        onboarding: { ...state.onboarding, step },
      })),
    skip: () =>
      update((state) => ({
        ...state,
        onboarding: { ...state.onboarding, status: "skipped" },
      })),
  };
}

export function LocalStateProvider({ children }: PropsWithChildren) {
  const value = useLocalStore();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLocalState() {
  const value = useContext(Context);
  if (!value) throw new Error("LocalStateProvider missing");
  return value;
}
