import { ApiError } from "./errors";
/** Framework-free scheduler: completion-based cadence, cancellation and generation fencing. */
export function createPoller<T>(load: (signal: AbortSignal)=>Promise<T>, receive: (value:T)=>void, fail: (error:unknown)=>void, intervalMs: number, pending: (value:boolean)=>void = ()=>{}) {
  let active=false; let generation=0; let controller:AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined; let inFlight:Promise<T> | undefined;
  function refresh(): Promise<T> {
    if(!active) return Promise.reject(new ApiError("cancelled","Polling is inactive"));
    if(inFlight) return inFlight;
    clearTimeout(timer); const token=generation; controller=new AbortController(); const signal=controller.signal;
    pending(true);
    const work=Promise.resolve().then(()=>load(signal)).then(value=>{if(active && token===generation) receive(value); return value;},error=>{if(active && token===generation) fail(error); throw error;}).finally(()=>{
      if(token===generation) {
        inFlight=undefined; controller=undefined; pending(false);
        if(active && intervalMs>0) timer=setTimeout(()=>{void refresh().catch(()=>{/* failure delivered to fail */});},intervalMs);
      }
    });
    inFlight=work; return work;
  }
  return {
    refresh,
    start() { if(active) return; active=true; void refresh().catch(()=>{/* failure delivered to fail */}); },
    stop() { active=false; ++generation; clearTimeout(timer); controller?.abort(); controller=undefined; inFlight=undefined; pending(false); },
  };
}
