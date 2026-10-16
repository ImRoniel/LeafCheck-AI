import { useEffect, useState } from "react";
import { api } from "@/services/api";

export function useAuthCapabilities() {
  const [attempt, setAttempt] = useState(0);
  const [capabilities, setCapabilities] = useState<{
    emailOtp: boolean; passwordRecovery: boolean; status: "loading" | "ready" | "error"; error: string | null;
  }>({ emailOtp: false, passwordRecovery: false, status: "loading", error: null });
  useEffect(() => {
    const controller = new AbortController();
    void api.authCapabilities({ signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setCapabilities({ ...value, status: "ready", error: null }); })
      .catch(() => {
        if (!controller.signal.aborted) setCapabilities({ emailOtp: false, passwordRecovery: false,
          status: "error", error: "Unable to load email sign-in options. Please try again." });
      });
    return () => controller.abort();
  }, [attempt]);
  return { ...capabilities, retry() {
    setCapabilities({ emailOtp: false, passwordRecovery: false, status: "loading", error: null });
    setAttempt(value => value + 1);
  } };
}
