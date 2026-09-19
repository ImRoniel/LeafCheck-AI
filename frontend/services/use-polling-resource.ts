import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError, asApiError } from "./errors";
import { createPoller } from "./poller";
export interface PollingOptions { enabled?: boolean; pollIntervalMs?: number }
export function usePollingResource<T>(key: string, load: (signal:AbortSignal)=>Promise<T>, options: PollingOptions = {}) {
  const focused=useIsFocused();
  const [appActive,setAppActive]=useState(AppState.currentState === "active");
  const [data,setData]=useState<T | null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<ApiError | null>(null);
  const poller=useRef<ReturnType<typeof createPoller<T>> | null>(null);
  const loader=useRef(load); loader.current=load;
  useEffect(()=>{const subscription=AppState.addEventListener("change",state=>setAppActive(state === "active")); return ()=>subscription.remove();},[]);
  useEffect(()=>{setData(null);setError(null);},[key]);
  useEffect(()=>{
    if(!key || options.enabled === false || !focused || !appActive) { setLoading(false); return; }
    const instance=createPoller(signal=>loader.current(signal),value=>{setData(value);setError(null);},reason=>setError(asApiError(reason)),options.pollIntervalMs ?? 15000,setLoading);
    poller.current=instance; instance.start();
    return ()=>{poller.current=null;instance.stop();};
  },[key,options.enabled,options.pollIntervalMs,focused,appActive]);
  const refresh=useCallback(()=>poller.current?.refresh() ?? Promise.reject(new ApiError("cancelled","Resource is not active")),[]);
  return {data,loading,error,refresh};
}
