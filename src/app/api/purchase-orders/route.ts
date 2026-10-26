import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PurchaseOrderDrafts} from '@/lib/d1-purchase-order-drafts';
import {PurchaseOrderError} from '@/lib/purchase-order-contract';
import {a8ReviewPolicy} from '@/lib/a8-review-source';
import {purchaseOrderHistoryQuery} from '@/lib/purchase-order-history-contract';

function enabled() {return (env as unknown as {PANTRACK_PO_DRAFT_PREVIEW?:string}).PANTRACK_PO_DRAFT_PREVIEW === 'enabled';}
function service() {return new D1PurchaseOrderDrafts(database(),{
  identity:async()=> (await getChatGPTUser())?.userId ?? null,salesPolicy:a8ReviewPolicy(),
});}
function failure(error: unknown,readOnly=false) {
  if (error instanceof PurchaseOrderError) {
    return Response.json({error:error.message,code:error.code},{status:
      error.code === 'forbidden' ? 403 : error.code === 'missing' ? 404 :
        error.code === 'invalid_request' ? 400 : error.code === 'storage_failure' ? 503 : 409});
  }
  return Response.json(readOnly?{error:'Purchase-order details could not be loaded. Please retry.'}:
    {error:'The save outcome may be uncertain. Retry the same request.',uncertain:true},{status:503});
}
async function handleGET(req: Request) {
  if (!enabled()) return Response.json({error:'Purchase-order draft preview is off.'},{status:404});
  const params = new URL(req.url).searchParams, companyId = params.get('companyId') ?? '';
  try {
    const store = service();
    const hasFilters=['q','supplier','status'].some(key=>params.has(key));
    if(hasFilters&&(params.has('orderId')||params.has('revision')||params.has('view'))){
      return Response.json({error:'Use history filters with the purchase-order list.'},{status:400});
    }
    if (params.get('view') === 'choices') return Response.json(await store.choices(companyId));
    const id = params.get('orderId');
    const revision=params.has('revision')?Number(params.get('revision')):undefined;
    if(revision!==undefined&&!id)return Response.json({error:'Choose a PO for revision history.'},{status:400});
    if(id)return Response.json({order:await store.get(companyId,id,revision)});
    if(req.url.length>8192)return Response.json({error:'History search is too large.'},{status:400});
    const selected=purchaseOrderHistoryQuery(params);
    return Response.json(await store.list(selected.companyId,selected.offset,selected.filters));
  } catch (error) {return failure(error,true);}
}
async function handlePOST(req: Request) {
  if (!enabled()) return Response.json({error:'Purchase-order draft preview is off.'},{status:404});
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || !('action' in body)) return Response.json({error:'Choose a PO action.'},{status:400});
    const store = service();
    if (!['create','edit','review','cancel'].includes(String(body.action))) return Response.json({error:'Choose create, edit, review or cancel. Purchase approval and sending are unavailable.'},{status:400});
    return Response.json({order:body.action === 'create' ? await store.create(body) : body.action==='edit'?await store.edit(body):
      body.action==='review'?await store.review(body):await store.cancel(body)});
  } catch (error) {return failure(error);}
}
const authorizedGET=withCompanyRoute('purchasing',handleGET);
export async function GET(req:Request){
  const response=await authorizedGET(req);response.headers.set('Cache-Control','private, no-store');return response;
}
export const POST = withCompanyRoute('purchasing',handlePOST);
