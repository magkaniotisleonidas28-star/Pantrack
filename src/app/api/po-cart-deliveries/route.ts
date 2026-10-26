import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PoCartDeliveries} from '@/lib/d1-po-cart-deliveries';
import {PoCartDeliveryError} from '@/lib/po-cart-delivery-contract';

// Delivery counts, manager approval and order closure for the fictional cart preview; off by default and local only.
function enabled(req:Request){return (env as unknown as {PANTRACK_CART_PREVIEW?:string}).PANTRACK_CART_PREVIEW==='enabled'
  &&new URL(req.url).hostname==='127.0.0.1';}
function service(){return new D1PoCartDeliveries(database(),{identity:async()=>(await getChatGPTUser())?.userId??null});}
function failure(error:unknown){
  if(error instanceof PoCartDeliveryError)
    return Response.json({error:error.message,code:error.code},{status:error.code==='forbidden'?403:error.code==='missing'?404:
      error.code==='invalid_request'?400:error.code==='storage_failure'?503:409});
  return Response.json({error:'Save outcome may be uncertain. Retry the same operation identity.',uncertain:true},{status:503});
}
export const GET=withCompanyRoute('deliveries',async(req:Request)=>{
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try {
    const query=Object.fromEntries(new URL(req.url).searchParams);
    return Response.json(query.view==='manager'?await service().manager(query):await service().staff(query));
  }catch(error){return failure(error);}
});
export const POST=withCompanyRoute('deliveries',async(req:Request)=>{
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try {
    const body:unknown=await req.json(),action=body&&typeof body==='object'&&'action' in body?body.action:null;
    if(action==='count')return Response.json(await service().count(body));
    if(action==='approve')return Response.json(await service().approve(body));
    if(action==='recount')return Response.json(await service().recount(body));
    if(action==='close')return Response.json(await service().close(body));
    return Response.json({error:'Choose count, approve, recount or close.'},{status:400});
  }catch(error){return failure(error);}
});
