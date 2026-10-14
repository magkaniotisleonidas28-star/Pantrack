import {D1PoCartBrowserSessions} from '@/lib/d1-po-cart-browser-sessions';
import {D1PoCartReconciliation} from '@/lib/d1-po-cart-reconciliation';
import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {a8ReviewPolicy} from '@/lib/a8-review-source';
import {D1PoCartJobs} from '@/lib/d1-po-cart-jobs';
import {PoCartJobError} from '@/lib/po-cart-job-contract';
import {PoCartAuthorizationError} from '@/lib/po-cart-authorization-contract';
import {CartPreparationError} from '@/lib/po-cart-preparation-contract';
import {PurchaseOrderError} from '@/lib/purchase-order-contract';
import {SupplierRegistryError} from '@/lib/purchasing-supplier-contract';
import {managerCartReceipt} from '@/lib/po-cart-manager-contract';

function enabled(req:Request){return (env as unknown as {PANTRACK_CART_PREVIEW?:string}).PANTRACK_CART_PREVIEW==='enabled'
  &&new URL(req.url).hostname==='127.0.0.1';}
function service(){return new D1PoCartJobs(database(),{identity:async()=>(await getChatGPTUser())?.userId??null,salesPolicy:a8ReviewPolicy()});}
function failure(error:unknown){
  if(error instanceof PoCartJobError||error instanceof PoCartAuthorizationError||error instanceof CartPreparationError||error instanceof PurchaseOrderError||error instanceof SupplierRegistryError)
    return Response.json({error:error.message,code:error.code},{status:error.code==='forbidden'?403:error.code==='missing'?404:
      error.code==='invalid_request'?400:error.code==='storage_failure'?503:409});
  return Response.json({error:'Save outcome may be uncertain. Retry the same operation identity.',uncertain:true},{status:503});
}
export const GET=withCompanyRoute('purchasing',async(req:Request)=>{
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try{
    const query=Object.fromEntries(new URL(req.url).searchParams);
    if(query.view==='manager')return Response.json({...await service().getManager(query),mode:
      (env as unknown as {PANTRACK_CART_BROWSER_LOCAL?:string}).PANTRACK_CART_BROWSER_LOCAL==='enabled'?'durable':'preview'});
    return Response.json(await service().get(query));
  }catch(e){return failure(e);}
});
export const POST=withCompanyRoute('purchasing',async(req:Request)=>{
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try{
    const body:unknown=await req.json();
    if(!body||typeof body!=='object'||!('action' in body)||!['enqueue','cancel','requestBrowser','closeBrowser','resume','acceptVerifiedCart','abandonVerifiedCart'].includes(String(body.action)))
      return Response.json({error:'Choose enqueue or cancel.'},{status:400});
    const action=String(body.action);
    if(['requestBrowser','closeBrowser','resume','acceptVerifiedCart','abandonVerifiedCart'].includes(action)&&(env as unknown as {PANTRACK_CART_BROWSER_LOCAL?:string}).PANTRACK_CART_BROWSER_LOCAL!=='enabled')return Response.json({error:'Practice browser access is off.'},{status:404});
    const sessions=new D1PoCartBrowserSessions(database(),{identity:async()=>(await getChatGPTUser())?.userId??null,salesPolicy:a8ReviewPolicy()});
    const result=action==='enqueue'?await service().enqueue(body):action==='cancel'?await service().cancel(body):
      action==='requestBrowser'?await sessions.requestBrowser(body):action==='closeBrowser'?await sessions.closeBrowser(body):action==='resume'?await sessions.resume(body):
      await new D1PoCartReconciliation(database(),{identity:async()=>(await getChatGPTUser())?.userId??null,salesPolicy:a8ReviewPolicy()}).decide(body);
    return Response.json(new URL(req.url).searchParams.get('view')==='manager'?{receipt:managerCartReceipt(result.receipt)}:result);
  }catch(e){return failure(e);}
});
