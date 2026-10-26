import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PoCartConfirmations} from '@/lib/d1-po-cart-confirmations';
import {PoCartConfirmationError} from '@/lib/po-cart-confirmation-contract';
import {PoCartJobError} from '@/lib/po-cart-job-contract';
import {a8ReviewPolicy} from '@/lib/a8-review-source';

// Manager-entered supplier confirmations for the fictional cart preview; off by default and local only.
function enabled(req:Request){return (env as unknown as {PANTRACK_CART_PREVIEW?:string}).PANTRACK_CART_PREVIEW==='enabled'
  &&new URL(req.url).hostname==='127.0.0.1';}
function service(){return new D1PoCartConfirmations(database(),{identity:async()=>(await getChatGPTUser())?.userId??null,salesPolicy:a8ReviewPolicy()});}
function failure(error:unknown){
  if(error instanceof PoCartConfirmationError||error instanceof PoCartJobError)
    return Response.json({error:error.message,code:error.code},{status:error.code==='forbidden'?403:error.code==='missing'?404:
      error.code==='invalid_request'?400:error.code==='storage_failure'?503:409});
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
    if(!body||typeof body!=='object'||!('action' in body)||body.action!=='record')return Response.json({error:'Choose record.'},{status:400});
    return Response.json(await service().record(body));
  }catch(error){return failure(error);}
});
