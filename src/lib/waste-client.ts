import type {ShortcutSubmission,WasteSubmission} from './waste-contract';

export type PendingWasteSave={kind:'waste';request:WasteSubmission}|{kind:'shortcuts';request:ShortcutSubmission};
export type WasteSaveOutcome={kind:'saved'}|{kind:'rejected';message:string;refresh:boolean}|{kind:'uncertain';message:string};

/** The caller persists the frozen request before sending and clears it only
 * after a confirmed success or rejection. No background/offline submission. */
export async function sendWasteSave(pending:PendingWasteSave,send:typeof fetch=fetch):Promise<WasteSaveOutcome>{
  return sendSaveRequest(pending.kind==='waste'?'/api/waste':'/api/waste/shortcuts',pending.request,send);
}
export async function sendSaveRequest(url:string,request:unknown,send:typeof fetch=fetch,previouslyUncertain=false):Promise<WasteSaveOutcome&{result?:unknown}>{
  try{
    const response=await send(url,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),
    });
    const body=await response.json() as {ok?:boolean;error?:string;code?:string;uncertain?:boolean;result?:unknown};
    if(response.ok&&body.ok===true)return {kind:'saved',result:body.result};
    // Authentication failure says nothing about an earlier ambiguous attempt.
    // Keep its identity through sign-in rather than creating a second movement.
    if(response.status===401)return {kind:'uncertain',message:'Your session has expired. Sign in again, then retry this same entry to confirm it.'};
    if(response.status===403)return {kind:'uncertain',message:'You cannot confirm this entry with your current access. Ask a manager for help; keep this tab open.'};
    if(response.status>=500||body.uncertain||body.code==='preview_disabled'||response.ok)return {kind:'uncertain',message:'We could not confirm the save. Retry this same entry to check it safely.'};
    if(previouslyUncertain)return {kind:'uncertain',message:'The earlier attempt still needs confirmation. Keep this entry and ask a manager for help; do not record it again.'};
    return {kind:'rejected',message:body.error||'The entry was not saved. Check the details and try again.',refresh:body.code==='concurrent_update'||body.code==='before_count_cutoff'};
  }catch{return {kind:'uncertain',message:'We could not confirm the save. Check your connection, then retry this same entry.'};}
}

export function wasteStorageKey(companyId:string,person:string){
  return 'pantrack-waste:'+JSON.stringify([companyId,person]);
}
