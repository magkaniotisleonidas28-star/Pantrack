import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PoCartAuthorizations} from '@/lib/d1-po-cart-authorizations';
import {PoCartAuthorizationError} from '@/lib/po-cart-authorization-contract';
import {CartPreparationError} from '@/lib/po-cart-preparation-contract';
import {PurchaseOrderError} from '@/lib/purchase-order-contract';
import {SupplierRegistryError} from '@/lib/purchasing-supplier-contract';
import {a8ReviewPolicy} from '@/lib/a8-review-source';
import {managerCartReceipt} from '@/lib/po-cart-manager-contract';

function enabled(req:Request){return (env as unknown as {PANTRACK_CART_PREVIEW?:string}).PANTRACK_CART_PREVIEW==='enabled'
  &&new URL(req.url).hostname==='127.0.0.1';}
function service(){return new D1PoCartAuthorizations(database(),{
  identity:async()=>(await getChatGPTUser())?.userId??null,salesPolicy:a8ReviewPolicy(),
});}
function failure(error:unknown){
  if(error instanceof PoCartAuthorizationError||error instanceof CartPreparationError||error instanceof PurchaseOrderError||error instanceof SupplierRegistryError)
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
    if(!body||typeof body!=='object'||!('action' in body)||!['authorize','cancel'].includes(String(body.action)))
      return Response.json({error:'Choose authorize or cancel.'},{status:400});
    const result=body.action==='authorize'?await service().authorize(body):await service().cancel(body);
    return Response.json(new URL(req.url).searchParams.get('view')==='manager'?{receipt:managerCartReceipt(result.receipt)}:result);
  }catch(error){return failure(error);}
});
