import { ApiError, asApiError, sanitizeErrorMessage } from "./errors";

export interface User {
  id: string;
  email: string;
  name: string | null;
}
export type Status =
  | "restoring"
  | "authenticating"
  | "signedOut"
  | "guest"
  | "authenticated"
  | "error";
export interface SessionState {
  status: Status;
  user: User | null;
  token: string | null;
  generation: number;
  error: string | null;
}
export interface TokenStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}
export interface Tokens {
  accessToken: string;
  refreshToken?: string;
}
export interface SessionTransport {
  login(body: { email: string; password: string }): Promise<Tokens>;
  register(body: {
    email: string;
    password: string;
    name?: string;
  }): Promise<Tokens>;
  refresh(body: { refreshToken?: string }): Promise<Tokens>;
  me(): Promise<User>;
  logout(token: string): Promise<void>;
}
export interface SessionCoordination {
  run<T>(work: () => Promise<T>): Promise<T>;
  broadcastLogout(): void;
  listenLogout(listener: () => void): () => void;
}
export interface SessionBridge {
  snapshot(): SessionState;
  signal(): AbortSignal;
  refresh(staleToken: string | null): Promise<void>;
  reject(): void;
}
export function parseUser(value: unknown): User {
  const candidate =
    value && typeof value === "object" && "user" in value ? value.user : value;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !("id" in candidate) ||
    typeof candidate.id !== "string" ||
    !candidate.id ||
    !("email" in candidate) ||
    typeof candidate.email !== "string" ||
    !("name" in candidate) ||
    (candidate.name !== null && typeof candidate.name !== "string")
  )
    throw new ApiError("validation", "Invalid profile response");
  return { id: candidate.id, email: candidate.email, name: candidate.name };
}
export function parseTokens(value: unknown): Tokens {
  if (
    !value ||
    typeof value !== "object" ||
    !("accessToken" in value) ||
    typeof value.accessToken !== "string" ||
    !value.accessToken
  )
    throw new ApiError("validation", "Invalid authentication response");
  return {
    accessToken: value.accessToken,
    ...("refreshToken" in value && typeof value.refreshToken === "string"
      ? { refreshToken: value.refreshToken }
      : {}),
  };
}
const cancelled = () => new ApiError("cancelled", "Session changed");
const sessionErrorMessage = (error: unknown) => {
  const e = asApiError(error);
  return e.message;
};
/** No React or API imports: the existing API singleton binds to this coordinator. */
export function createSessionCoordinator(
  storage: TokenStorage,
  native: boolean,
  coordination: SessionCoordination,
) {
  let state: SessionState = {
    status: "restoring",
    user: null,
    token: null,
    generation: 0,
    error: null,
  };
  let controller = new AbortController();
  let transport: SessionTransport;
  let refreshFlight: Promise<void> | null = null;
  let restoreFlight: Promise<void> | null = null;
  let operation = false;
  let storageQueue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: Partial<SessionState>) => {
    state = { ...state, ...next };
    listeners.forEach((fn) => fn());
  };
  const store = <T>(work: () => Promise<T>): Promise<T> => {
    const next = storageQueue.then(work);
    storageQueue = next.catch(() => {});
    return next;
  };
  const check = (generation: number) => {
    if (generation !== state.generation) throw cancelled();
  };
  const boundary = (status: Status) => {
    controller.abort();
    controller = new AbortController();
    publish({
      status,
      user: null,
      token: null,
      error: null,
      generation: state.generation + 1,
    });
  };
  const erase = async () => {
    if (native) await store(() => storage.remove());
  };
  const invalidate = (message?: string) => {
    boundary("signedOut");
    const generation = state.generation;
    if (message) publish({ error: message });
    void erase().catch(
      () =>
        generation === state.generation &&
        publish({
          error:
            "Secure storage could not be cleared. Sign in again before continuing.",
        }),
    );
  };
  async function commit(tokens: Tokens, generation: number) {
    check(generation);
    if (native) {
      if (!tokens.refreshToken)
        throw new ApiError("validation", "Native refresh credential missing");
      await store(async () => {
        check(generation);
        await storage.set(tokens.refreshToken!);
      });
    }
    check(generation);
    publish({ token: tokens.accessToken });
  }
  async function refresh(staleToken: string | null) {
    if (state.token && state.token !== staleToken) return;
    if (refreshFlight) return refreshFlight;
    const generation = state.generation;
    const work = coordination.run(async () => {
      check(generation);
      let submitted = false;
      try {
        const credential = native ? await store(() => storage.get()) : null;
        check(generation);
        if (native && !credential)
          throw new ApiError("http", "Please sign in again", 401);
        submitted = true;
        const tokens = await transport.refresh(
          native ? { refreshToken: credential! } : {},
        );
        await commit(tokens, generation);
      } catch (error) {
        if (generation === state.generation) {
          const e = asApiError(error);
          // A consumed native token must never be resubmitted after an ambiguous result.
          if (submitted || e.status === 401 || e.status === 403)
            invalidate("Session could not be renewed. Please sign in again.");
          else
            publish({
              status: "error",
              // Before submission, failures can come from local secure storage.
              error: sanitizeErrorMessage(
                error instanceof Error ? error.message : e.message,
              ),
            });
        }
        throw error;
      }
    });
    refreshFlight = work;
    try {
      await work;
    } finally {
      if (refreshFlight === work) refreshFlight = null;
    }
  }
  async function restore() {
    if (operation) return;
    if (restoreFlight) return restoreFlight;
    if (state.status !== "restoring" && state.status !== "error") return;
    const work = (async () => {
      publish({ status: "restoring", error: null });
      const restoreGeneration = state.generation;
      try {
        if (!state.token) await refresh(null);
        check(restoreGeneration);
        const generation = state.generation;
        const user = await transport.me();
        check(generation);
        publish({ status: "authenticated", user, error: null });
      } catch (error) {
        if (
          state.status === "restoring" &&
          state.generation === restoreGeneration
        ) {
          const e = asApiError(error);
          if (e.status === 401 || e.status === 403) invalidate();
          else publish({ status: "error", error: sessionErrorMessage(e) });
        }
      }
    })();
    restoreFlight = work;
    try {
      await work;
    } finally {
      restoreFlight = null;
    }
  }
  async function authenticate(
    kind: "login" | "register",
    body: { email: string; password: string; name?: string },
  ) {
    if (operation)
      throw new ApiError("busy", "Authentication is already in progress");
    operation = true;
    boundary("authenticating");
    coordination.broadcastLogout();
    const generation = state.generation;
    try {
      // Wait out an old rotation before replacing its credential/cookie.
      await refreshFlight?.catch(() => {});
      check(generation);
      await erase();
      await coordination.run(async () => {
        check(generation);
        const tokens = await transport[kind](body);
        await commit(tokens, generation);
      });
      const user = await transport.me();
      check(generation);
      publish({ status: "authenticated", user });
    } catch (error) {
      if (generation === state.generation) {
        if (
          state.token &&
          asApiError(error).status !== 401 &&
          asApiError(error).status !== 403
        )
          publish({ status: "error", error: sessionErrorMessage(error) });
        else invalidate(sessionErrorMessage(error));
      }
      throw error;
    } finally {
      operation = false;
    }
  }
  return {
    bind(value: SessionTransport) {
      transport = value;
    },
    snapshot: () => state,
    signal: () => controller.signal,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () =>
      coordination.listenLogout(() => invalidate("Signed out in another tab.")),
    restore,
    refresh,
    reject: () => invalidate("Session expired. Please sign in again."),
    login: (body: { email: string; password: string }) =>
      authenticate("login", body),
    register: (body: { email: string; password: string; name?: string }) =>
      authenticate("register", body),
    async logout() {
      const token = state.token;
      boundary("signedOut");
      coordination.broadcastLogout();
      const generation = state.generation;
      const clear = erase().then(
        () => null,
        (error) => error,
      );
      try {
        await refreshFlight?.catch(() => {});
        await coordination.run(async () => {
          if (token) await transport.logout(token);
        });
        const failure = await clear;
        if (failure) throw failure;
      } catch (error) {
        await clear;
        if (generation === state.generation)
          publish({
            error:
              "Signed out locally. Server logout or secure-storage cleanup failed; sign in again to revoke the session.",
          });
        throw error;
      }
    },
    enterGuest() {
      if (state.status === "authenticated") return;
      boundary("guest");
    },
    leaveGuest() {
      boundary("signedOut");
    },
  };
}
