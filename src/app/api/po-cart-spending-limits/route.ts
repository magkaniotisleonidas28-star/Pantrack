import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PoCartSpendingLimits} from '@/lib/d1-po-cart-spending-limits';
import {SpendingLimitError} from '@/lib/po-cart-spending-limits-contract';

// Owner-only limits for the fictional cart preview; off by default and local only.
function enabled(req:Request){return (env as unknown as {PANTRACK_CART_PREVIEW?:string}).PANTRACK_CART_PREVIEW==='enabled'
  &&new URL(req.url).hostname==='127.0.0.1';}
function service(){return new D1PoCartSpendingLimits(database(),{identity:getChatGPTUser});}
function failure(error:unknown){
  if(error instanceof SpendingLimitError)return Response.json({error:error.message,code:error.code},{status:error.code==='forbidden'?403:
    error.code==='reauthentication_required'?403:error.code==='invalid_request'?400:error.code==='storage_failure'?503:409});
  return Response.json({error:'Save outcome may be uncertain. Retry the same operation identity.',uncertain:true},{status:503});
}
export const GET=withCompanyRoute('purchasing',async(req:Request)=>{
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try {return Response.json(await service().get(Object.fromEntries(new URL(req.url).searchParams)));}
  catch(error){return failure(error);}
});
export const POST=withCompanyRoute('purchasing',async(req:Request)=>{
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try {
    const body:unknown=await req.json();
    if(!body||typeof body!=='object'||!('action' in body)||!['set_limits','set_time_zone'].includes(String(body.action)))
      return Response.json({error:'Choose set_limits or set_time_zone.'},{status:400});
    return Response.json(body.action==='set_limits'?await service().setLimits(body):await service().setTimeZone(body));
  }catch(error){return failure(error);}
});
