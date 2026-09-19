import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { analyzePlant } from "../services/api";
import { ApiError, asApiError } from "../services/errors";
import type { AIDiagnosisRequest, AIDiagnosisResponse } from "../types";
export function usePlantHealth() {
  const [analyzing,setAnalyzing]=useState(false);
  const [diagnosisResult,setDiagnosisResult]=useState<AIDiagnosisResponse | null>(null);
  const [error,setError]=useState<ApiError | null>(null);
  const controller=useRef<AbortController | null>(null);
  const generation=useRef(0);
  const focused=useIsFocused();
  const cancel=useCallback(()=>{++generation.current;controller.current?.abort();controller.current=null;setAnalyzing(false);},[]);
  useEffect(()=>{if(!focused) cancel();},[focused,cancel]);
  useEffect(()=>{const sub=AppState.addEventListener("change",state=>{if(state !== "active") cancel();}); return ()=>{sub.remove();++generation.current;controller.current?.abort();controller.current=null;};},[cancel]);
  const diagnosePlant=useCallback(async(request:AIDiagnosisRequest)=>{
    if(controller.current) throw new ApiError("busy","Analysis is already running");
    if(!focused || AppState.currentState !== "active") throw new ApiError("cancelled","Screen is inactive");
    const token=++generation.current; const abort=new AbortController();controller.current=abort;
    setAnalyzing(true);setError(null);
    try {const result=await analyzePlant(request,{signal:abort.signal}); if(token === generation.current) setDiagnosisResult(result); return result;}
    catch(reason) {const failure=asApiError(reason);if(token === generation.current) setError(failure);throw failure;}
    finally {if(token === generation.current) {controller.current=null;setAnalyzing(false);}}
  },[focused]);
  return {analyzePlant:diagnosePlant,analyzing,diagnosisResult,error,cancel};
}
