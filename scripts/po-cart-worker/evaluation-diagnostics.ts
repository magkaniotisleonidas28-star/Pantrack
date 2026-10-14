import {readFileSync,lstatSync} from 'node:fs';
import {providerPhases} from '../cart-preview/ai-provider';

export function verifyEvaluationDiagnostics(path:string,phases:string[],additions:number){
 try{
  const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o777)!==0o600))return false;
  const events=readFileSync(path,'utf8').trim().split('\n').map(s=>JSON.parse(s));
  if(!events.length||events.length>500||events.some((e,i)=>!Number.isSafeInteger(e.elapsedMs)||e.elapsedMs<0||(i>0&&e.elapsedMs<events[i-1].elapsedMs)||['form_ready','form_events','provider_failed','provider_aborted'].includes(e.event)))return false;
  const provider=events.filter(e=>e.event.startsWith('provider_'));
  if(provider.length!==phases.length*4)return false;
  for(const [i,phase] of phases.entries()){
   const batch=provider.slice(i*4,i*4+4);
   if(batch.map(e=>e.event).join(',')!=='provider_reserved,provider_start,provider_headers,provider_complete'||batch.some(e=>e.phaseId!==providerPhases.indexOf(phase))||batch[2].status!==200||batch.some((e,j)=>!Number.isSafeInteger(e.durationMs)||e.durationMs<0||(j>0&&e.durationMs<batch[j-1].durationMs)))return false;
  }
  const metadata=provider.filter(e=>providerPhases[e.phaseId]?.endsWith(':Metadata'));
  const verdicts=events.filter(e=>e.event==='metadata_verdict');
  if(verdicts.length!==metadata.length/4)return false;
  for(const verdict of verdicts){
   const previous=events[events.indexOf(verdict)-1];
   if(!Number.isInteger(verdict.classification)||verdict.classification<0||verdict.classification>3
    ||!providerPhases[verdict.phaseId]?.endsWith(':Metadata')||previous?.event!=='provider_complete'||previous.phaseId!==verdict.phaseId
    ||Object.keys(verdict).some(k=>!['at','elapsedMs','event','phaseId','classification'].includes(k)))return false;
  }
  for(const event of ['quantity_filled','attempt_ack','click_dispatch','click_done','add_request','add_response','add_finished','proxy_add','proxy_forward','proxy_response','proxy_end'])if(events.filter(e=>e.event===event).length!==additions)return false;
  if(!events.some(e=>e.event==='ownership_check')||!events.some(e=>e.event==='closed'))return false;
  const clicks=events.filter(e=>['quantity_filled','attempt_ack','click_dispatch'].includes(e.event));
  return clicks.every((e,i)=>e.event===['quantity_filled','attempt_ack','click_dispatch'][i%3]);
 }catch{return false;}
}
