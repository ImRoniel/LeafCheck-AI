import assert from "node:assert/strict";
import test from "node:test";
import { createPoller } from "../services/poller";
test("refresh coalesces, stop aborts, late results are suppressed",async()=>{
  let calls=0;let resolve!:(value:number)=>void;let signal!:AbortSignal;const values:number[]=[];
  const poller=createPoller<number>(s=>{calls++;signal=s;return new Promise(done=>{resolve=done;});},v=>values.push(v),()=>{},0);
  poller.start();const first=poller.refresh();assert.equal(first,poller.refresh());await Promise.resolve();assert.equal(calls,1);
  poller.stop();assert.equal(signal.aborted,true);resolve(1);await first;assert.deepEqual(values,[]);
});
test("restart fences old failures and publishes new data",async()=>{
  let reject!:(error:Error)=>void;let calls=0;const values:number[]=[];const errors:unknown[]=[];
  const poller=createPoller<number>(()=>++calls===1 ? new Promise((_,fail)=>{reject=fail;}) : Promise.resolve(2),v=>values.push(v),e=>errors.push(e),0);
  poller.start();const old=poller.refresh();await Promise.resolve();poller.stop();poller.start();await poller.refresh();reject(new Error("old"));await assert.rejects(old);assert.deepEqual(values,[2]);assert.deepEqual(errors,[]);poller.stop();
});
