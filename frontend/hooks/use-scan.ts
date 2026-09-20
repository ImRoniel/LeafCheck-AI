import { usePathname } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { ApiError } from "../services/errors";
import { createScanFlow } from "../services/scan-flow";
import type { ScanRequest } from "../types";
export function useScan() {
  const [flow] = useState(() => createScanFlow());
  const state = useSyncExternalStore(
    flow.subscribe,
    flow.getState,
    flow.getState,
  );
  const pathname = usePathname();
  const focused = pathname === "/camera" || pathname.endsWith("/camera");
  useEffect(() => {
    if (!focused) flow.cancel();
  }, [focused, flow]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flow.cancel();
    });
    return () => {
      sub.remove();
      flow.cancel();
    };
  }, [flow]);
  const scan = (request: ScanRequest) =>
    !focused || AppState.currentState !== "active"
      ? Promise.reject(new ApiError("cancelled", "Screen is inactive"))
      : flow.scan(request);
  const retrySynchronization = () =>
    !focused || AppState.currentState !== "active"
      ? Promise.reject(new ApiError("cancelled", "Screen is inactive"))
      : flow.retrySynchronization();
  return {
    ...state,
    scanning: state.phase === "scanning",
    synchronizing: state.phase === "synchronizing",
    scan,
    scanPlant: scan,
    retrySynchronization,
    cancel: flow.cancel,
    reset: flow.reset,
  };
}
