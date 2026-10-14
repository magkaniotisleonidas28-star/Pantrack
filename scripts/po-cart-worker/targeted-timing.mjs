import {performance} from 'node:perf_hooks';
import {setTimeout as delayMs} from 'node:timers/promises';

const phases=['baseline:Extraction','baseline:Metadata','product:DEMO-COFFEE:Extraction','product:DEMO-COFFEE:Metadata'];
export const callbackOffsetsMs=[0,812,8027,8906];
export function targetedCases(){
 const cases=[];
 for(const profile of ['uneven','heartbeat'])for(const [readerIndex,mode] of ['deterministic','stagehand'].entries())
  for(const [diagnosticIndex,diagnosticMode] of ['off','passive','form'].entries())for(const [layoutIndex,layout] of ['rows','compact'].entries())
   cases.push({profile,mode,diagnosticMode,layout,responseDelayMs:250,
    firstBeginTargetMs:profile==='uneven'?16000:(readerIndex+diagnosticIndex+layoutIndex)%2===0?19750:20250});
 return cases;
}

// Test harness only: wait before mock reservations or before calling mutate.
// Never delay a network operation under its timeout or wait after an add grant.
export function targetedTiming(spec,{now=()=>performance.now(),sleep=(ms,signal)=>delayMs(ms,undefined,{signal})}={}){
 let claimedAt,firstCallbackAt,firstBeginMs;const callbacks=[],heartbeatMs=[];
 const waitUntil=async(target,signal)=>{signal?.throwIfAborted();const remaining=target-now();if(remaining>0)await sleep(remaining,signal);signal?.throwIfAborted();};
 return {
  claimed(){if(claimedAt!==undefined)throw Error('Targeted job may only claim once.');claimedAt=now();},
  heartbeat(){if(claimedAt!==undefined)heartbeatMs.push(Math.round(now()-claimedAt));},
  async beforeBegin(signal){
   signal?.throwIfAborted();
   if(firstBeginMs!==undefined)return;
   if(claimedAt===undefined)throw Error('Targeted claim was not observed.');
   await waitUntil(claimedAt+spec.firstBeginTargetMs,signal);firstBeginMs=Math.round(now()-claimedAt);
  },
  async beforeRequest(context){
   context.signal?.throwIfAborted();
   const index=callbacks.length;firstCallbackAt??=now();
   if(spec.profile==='uneven'&&index<4){
    if(context.phase!==phases[index])throw Error('Unexpected targeted callback sequence.');
    await waitUntil(firstCallbackAt+callbackOffsetsMs[index],context.signal);
   }
   callbacks.push(Math.round(now()-firstCallbackAt));
  },
  report(){
   const callbackTimingMet=spec.profile!=='uneven'||spec.mode!=='stagehand'||callbacks.length>=4&&callbackOffsetsMs.every((offset,i)=>Math.abs(callbacks[i]-offset)<=250);
   const beginTimingMet=firstBeginMs!==undefined&&Math.abs(firstBeginMs-spec.firstBeginTargetMs)<=250;
   const heartbeatTimingMet=spec.profile!=='heartbeat'||heartbeatMs.some(ms=>Math.abs(ms-20000)<=250);
   return {firstBeginTargetMs:spec.firstBeginTargetMs,firstBeginMs:firstBeginMs??null,callbackOffsetsMs:callbacks,heartbeatMs,
    callbackTimingMet,beginTimingMet,heartbeatTimingMet,timingMet:callbackTimingMet&&beginTimingMet&&heartbeatTimingMet};
  }
 };
}
