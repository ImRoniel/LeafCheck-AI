import { ApiError } from "./errors";
import type { SessionCoordination } from "./session";

/** Never emulate a cross-tab mutex with a racy localStorage lease. Fail closed. */
export function createBrowserCoordination(scope: string): SessionCoordination {
  const name = `leafcheck-auth:${scope}`;
  return {
    async run(work) {
      if (typeof navigator === "undefined" || !navigator.locks)
        throw new ApiError(
          "application",
          "Secure browser session coordination is unavailable. Use a browser with Web Locks over HTTPS or the native app.",
        );
      return navigator.locks.request(name, { mode: "exclusive" }, work);
    },
    broadcastLogout() {
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(name);
        channel.postMessage("logout");
        channel.close();
      }
      // Nonsecret event only; no access/refresh credential ever enters storage.
      try {
        localStorage.setItem(
          `${name}:logout`,
          `${Date.now()}:${Math.random()}`,
        );
      } catch {
        /* BroadcastChannel remains available. */
      }
    },
    listenLogout(listener) {
      if (typeof window === "undefined") return () => {};
      const channel =
        typeof BroadcastChannel !== "undefined"
          ? new BroadcastChannel(name)
          : null;
      if (channel)
        channel.onmessage = (event) => {
          if (event.data === "logout") listener();
        };
      const onStorage = (event: StorageEvent) => {
        if (event.key === `${name}:logout` && event.newValue) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        channel?.close();
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}
