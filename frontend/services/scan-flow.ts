import type { Plant, ScanRequest, ScanResponse } from "../types";
import { api, type ApiClient } from "./api";
import { ApiError, asApiError } from "./errors";
export interface ScanFlowState {
  phase: "idle" | "scanning" | "synchronizing" | "complete" | "error";
  report: ScanResponse | null;
  plant: Plant | null;
  error: ApiError | null;
  synchronizationError: ApiError | null;
}
/** A report is committed before synchronization. Retry never replays the paid scan. */
export function createScanFlow(client: Pick<ApiClient,"scanPlant" | "updatePlantHealth" | "fetchPlant"> = api) {
  let state: ScanFlowState = {phase:"idle",report:null,plant:null,error:null,synchronizationError:null};
  let controller: AbortController | undefined;
  let busy = false;
  let generation = 0;
  let plantId: string | undefined;
  let patched = false;
  const listeners = new Set<()=>void>();
  const publish = (next: Partial<ScanFlowState>) => { state={...state,...next}; listeners.forEach(listener=>listener()); };
  async function synchronize(token: number, signal: AbortSignal) {
    const report = state.report!;
    publish({phase:"synchronizing",synchronizationError:null});
    try {
      if(!patched) {
        await client.updatePlantHealth(plantId!,report.diagnostic.healthStatus,{signal});
        if(token !== generation) return;
        patched=true;
      }
      const plant = await client.fetchPlant(plantId!,{signal});
      if(token === generation) publish({phase:"complete",plant});
    } catch(error) {
      if(token === generation) publish({phase:"error",synchronizationError:asApiError(error)});
      throw error;
    }
  }
  return {
    getState: () => state,
    subscribe(listener: ()=>void) { listeners.add(listener); return ()=>{listeners.delete(listener);}; },
    async scan(request: ScanRequest): Promise<ScanResponse> {
      if(busy) throw new ApiError("busy","A scan or synchronization is already running");
      if(state.report && state.phase !== "complete") throw new ApiError("busy","Synchronize or reset the retained report before another scan");
      busy=true; const token=++generation; controller=new AbortController(); const signal=controller.signal;
      plantId=request.plantId; patched=false;
      publish({phase:"scanning",report:null,plant:null,error:null,synchronizationError:null});
      try {
        const report=await client.scanPlant(request,{signal});
        if(token !== generation) throw new ApiError("cancelled","Scan cancelled");
        publish({report});
        await synchronize(token,signal);
        return report;
      } catch(error) {
        if(token === generation && !state.report) publish({phase:"error",error:asApiError(error)});
        throw error;
      } finally { if(token === generation) { busy=false; controller=undefined; } }
    },
    async retrySynchronization(): Promise<void> {
      if(busy) throw new ApiError("busy","Synchronization is already running");
      if(!state.report) throw new ApiError("validation","No successful report to synchronize");
      if(state.phase === "complete") return;
      busy=true; const token=++generation; controller=new AbortController();
      try { await synchronize(token,controller.signal); }
      finally { if(token === generation) { busy=false; controller=undefined; } }
    },
    cancel() {
      if(!busy) return;
      ++generation; controller?.abort(); controller=undefined; busy=false;
      const error=new ApiError("cancelled","Operation cancelled");
      publish(state.report ? {phase:"error",synchronizationError:error} : {phase:"error",error});
    },
    reset() {
      if(busy) throw new ApiError("busy","Cancel the current operation before resetting");
      plantId=undefined; patched=false;
      publish({phase:"idle",report:null,plant:null,error:null,synchronizationError:null});
    },
  };
}
