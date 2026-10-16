import { useEffect, useState } from "react";
import { api } from "@/services/api";

export function useAuthCapabilities() {
  const [capabilities, setCapabilities] = useState({ emailOtp: false, passwordRecovery: false });
  useEffect(() => {
    const controller = new AbortController();
    void api.authCapabilities({ signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setCapabilities(value); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return capabilities;
}
