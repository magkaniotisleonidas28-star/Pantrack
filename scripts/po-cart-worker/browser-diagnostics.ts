import {mkdirSync,openSync,writeSync,closeSync} from 'node:fs';
import {dirname} from 'node:path';
import {performance} from 'node:perf_hooks';

// Internal opt-in evidence: no strings supplied by pages, HTTP, SDKs or errors.
export type Diagnostic=(event:string,fields?:Record<string,boolean|number>)=>void;
const events=new Set(['launch','connected','disconnected','page_closed','page_crashed','closing','closed','stop',
 'provider_reserved','provider_start','provider_headers','provider_complete','provider_failed','provider_aborted','metadata_verdict',
 'catalog_ready','quantity_filled','attempt_ack','ownership_check','click_dispatch',
 'heartbeat_start','heartbeat_ok','heartbeat_failed','ownership_ok','ownership_lost','inspection_start','inspection_ok',
 'form_ready','click_start','click_done','click_failed','form_events','add_request','add_response','add_finished','add_failed',
 'proxy_add','proxy_forward','proxy_response','proxy_end','proxy_aborted','proxy_error','failure']);
const fields=new Set(['status','valid','enabled','connected','owned','count','clicked','submitted','invalid','focused','stage','phaseId','durationMs','classification']);
export function browserDiagnostics(path?:string,io={write:writeSync,close:closeSync}):{enabled:boolean;healthy:()=>boolean;emit:Diagnostic;close:()=>void}{
 if(!path)return {enabled:false,healthy:()=>true,emit:()=>{},close:()=>{}};
 mkdirSync(dirname(path),{recursive:true,mode:0o700});const fd=openSync(path,'wx',0o600);let count=0,closed=false,failed=false;const start=performance.now();
 return {enabled:true,healthy:()=>!failed,emit:(event,data={})=>{
  if(closed||failed||!events.has(event))return;
  if(count>=500){failed=true;return;}
  const safe=Object.fromEntries(Object.entries(data).filter(([k,v])=>fields.has(k)&&(typeof v==='boolean'||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)));
  try{io.write(fd,JSON.stringify({at:new Date().toISOString(),elapsedMs:Math.round(performance.now()-start),event,...safe})+'\n');count++;}catch{failed=true;}
 },close:()=>{if(!closed){closed=true;try{io.close(fd);}catch{failed=true;}}}};
}
