import {getChatGPTUser} from './chatgpt-auth';
import {database} from '@/db/raw';
import {exactInventoryPreviewEnabled} from './exact-inventory-gate';
import {D1WasteService} from './d1-waste';
import {InventoryManagementError} from './d1-inventory-management';
import {QuantityError} from './inventory-quantities';
import {z} from 'zod';

export async function handleWaste(req:Request,shortcuts=false){
  if(!exactInventoryPreviewEnabled())return Response.json({error:'Waste recording is not enabled in this workspace.',code:'preview_disabled'},{status:404});
  try{
    const service=new D1WasteService(database());
    if(req.method==='GET')return Response.json(await service.options(new URL(req.url).searchParams.get('companyId')!));
    const user=await getChatGPTUser();
    if(!user)return Response.json({error:'Your session has expired. Sign in before saving.'},{status:401});
    const input:unknown=await req.json();
    // Identity comes exclusively from the authenticated session.
    const result=shortcuts?await service.saveShortcuts(input,user.userId):await service.record(input,user.userId);
    return Response.json({ok:true,result});
  }catch(error){
    if(error instanceof z.ZodError)return Response.json({error:'Check the ingredient, quantity, reason, and optional note.'},{status:400});
    if(error instanceof InventoryManagementError||error instanceof QuantityError){
      if(error.code==='corrupt_store')throw error;
      const status=error.code==='not_found'?404:['concurrent_update','operation_conflict','unit_incompatible'].includes(error.code)?409:400;
      const message=error.code==='before_count_cutoff'?'A newer stock count is recorded. Refresh and save this entry again.':error.message;
      return Response.json({error:message,code:error.code},{status});
    }
    return Response.json({error:'The save outcome is uncertain. Retry this same entry.',uncertain:true},{status:503});
  }
}
