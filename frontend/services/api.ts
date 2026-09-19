import type { AIDiagnosisRequest, HealthStatus, ScanRequest } from "../types";
import { ApiError, asApiError } from "./errors";
import { platformOS } from "./platform";
import * as v from "./validators";
export { ApiError } from "./errors";
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface HistoryQuery { limit?: number; offset?: number }
export function resolveApiBaseUrl(env: string | undefined, platform: string): string {
  const url = env?.trim() || `http://${platform === "android" ? "10.0.2.2" : "localhost"}:3000`;
  if(!/^https?:\/\//i.test(url)) throw new ApiError("validation", "API URL must use HTTP or HTTPS");
  return url.replace(/\/+$/, "");
}
export function createApiClient(config: { baseUrl?: string; platform?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const base = resolveApiBaseUrl(config.baseUrl ?? process.env.EXPO_PUBLIC_API_URL, config.platform ?? platformOS);
  const transport = config.fetch ?? globalThis.fetch;
  async function request<T>(path: string, parser: (value: unknown)=>T, options: RequestOptions = {}, method = "GET", body?: unknown, allow404 = false): Promise<T> {
    const controller = new AbortController();
    const timeout = options.timeoutMs ?? config.timeoutMs ?? 30000;
    if(!Number.isFinite(timeout) || timeout <= 0) throw new ApiError("validation", "timeoutMs must be positive");
    let abortError: ApiError | undefined;
    let rejectAbort!: (reason: unknown)=>void;
    const aborted = new Promise<never>((_,reject)=> { rejectAbort=reject; });
    const abort = (kind: "timeout" | "cancelled") => { abortError = new ApiError(kind, kind === "timeout" ? "Request timed out" : "Request cancelled"); controller.abort(); rejectAbort(abortError); };
    const cancel = () => abort("cancelled");
    options.signal?.addEventListener("abort",cancel,{once:true});
    const timer = setTimeout(()=>abort("timeout"), timeout);
    try {
      if(options.signal?.aborted) cancel();
      return await Promise.race([aborted, (async()=> {
        if(controller.signal.aborted) throw abortError;
        const response = await transport(`${base}${path}`,{method,signal:controller.signal,headers:{Accept:"application/json",...(body === undefined ? {} : {"Content-Type":"application/json"})},...(body === undefined ? {} : {body:JSON.stringify(body)})});
        if(allow404 && response.status === 404) return null as T;
        let payload: unknown;
        try { payload = await response.json(); } catch { if(!response.ok) throw new ApiError("http",`HTTP ${response.status}`,response.status); throw new ApiError("validation","Response is not valid JSON"); }
        if(!response.ok) throw new ApiError("http", typeof (payload as {error?:unknown})?.error === "string" ? (payload as {error:string}).error : `HTTP ${response.status}`,response.status,payload);
        if(payload && typeof payload === "object" && "success" in payload && payload.success === false) {
          const message = (payload as {error?:unknown}).error;
          throw new ApiError("application",typeof message === "string" ? message : "Operation failed",response.status,payload);
        }
        return parser(payload);
      })()]);
    } catch(error) { throw abortError ?? asApiError(error); }
    finally { clearTimeout(timer); options.signal?.removeEventListener("abort",cancel); }
  }
  const id = (value: string) => { v.nonempty(value,"id"); return encodeURIComponent(value); };
  return {
    fetchUserPlants: (options?: RequestOptions) => request("/api/plants",v.parsePlants,options),
    fetchPlant: (plantId: string, options?: RequestOptions) => request(`/api/plants/${id(plantId)}`,v.parsePlant,options),
    updatePlantHealth: (plantId: string, healthStatus: HealthStatus, options?: RequestOptions) => { v.health(healthStatus,"healthStatus"); return request(`/api/plants/${id(plantId)}/health`,v.parseHealth,options,"PATCH",{healthStatus}); },
    fetchLatestTelemetry: (deviceId: string, options?: RequestOptions) => request<import("../types").TelemetryPayload | null>(`/api/telemetry/${id(deviceId)}/latest`,v.parseTelemetry,options,"GET",undefined,true),
    fetchTelemetryHistory: (deviceId: string, query: HistoryQuery = {}, options?: RequestOptions) => {
      const {limit=50,offset=0} = query;
      if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0) throw new ApiError("validation","Invalid history pagination");
      return request(`/api/telemetry/${id(deviceId)}/history?limit=${limit}&offset=${offset}`,v.parseHistory,options);
    },
    scanPlant: (body: ScanRequest, options?: RequestOptions) => { v.object({plantId:v.nonempty,imageBase64:v.nonempty})(body,"scan"); if(body.deviceId !== undefined) v.nonempty(body.deviceId,"deviceId"); return request("/api/scan",v.parseScan,options,"POST",body); },
    analyzePlant: (body: AIDiagnosisRequest, options?: RequestOptions) => {
      v.object({})(body,"analysis");
      for(const key of ["imageBase64","plantId","notes"] as const) if(body[key] !== undefined) v.text(body[key],key);
      if(body.telemetry !== undefined) v.telemetryCheck(body.telemetry,"telemetry");
      return request("/api/ai/analyze",v.parseAnalysis,options,"POST",body);
    },
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
export const api = createApiClient();
export const { fetchUserPlants, fetchPlant, updatePlantHealth, fetchLatestTelemetry, fetchTelemetryHistory, scanPlant, analyzePlant } = api;
