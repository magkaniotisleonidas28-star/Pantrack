import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PurchaseOrderDrafts} from '@/lib/d1-purchase-order-drafts';
import {PurchaseOrderError} from '@/lib/purchase-order-contract';
import {a8ReviewPolicy} from '@/lib/a8-review-source';

function enabled() {return (env as unknown as {PANTRACK_PO_DRAFT_PREVIEW?:string}).PANTRACK_PO_DRAFT_PREVIEW === 'enabled';}
function service() {return new D1PurchaseOrderDrafts(database(),{
  identity:async()=> (await getChatGPTUser())?.userId ?? null,salesPolicy:a8ReviewPolicy(),
});}
function failure(error: unknown) {
  if (error instanceof PurchaseOrderError) {
    return Response.json({error:error.message,code:error.code},{status:
      error.code === 'forbidden' ? 403 : error.code === 'missing' ? 404 :
        error.code === 'invalid_request' ? 400 : error.code === 'storage_failure' ? 503 : 409});
  }
  return Response.json({error:'The save outcome may be uncertain. Retry the same request.',uncertain:true},{status:503});
}
async function handleGET(req: Request) {
  if (!enabled()) return Response.json({error:'Purchase-order draft preview is off.'},{status:404});
  const params = new URL(req.url).searchParams, companyId = params.get('companyId') ?? '';
  try {
    const store = service();
    if (params.get('view') === 'choices') return Response.json(await store.choices(companyId));
    const id = params.get('orderId');
    return Response.json(id ? {order:await store.get(companyId,id)} : await store.list(companyId,Number(params.get('offset') ?? '0')));
  } catch (error) {return failure(error);}
}
async function handlePOST(req: Request) {
  if (!enabled()) return Response.json({error:'Purchase-order draft preview is off.'},{status:404});
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== 'object' || !('action' in body)) return Response.json({error:'Choose a PO action.'},{status:400});
    const store = service();
    if (body.action !== 'create' && body.action !== 'cancel') return Response.json({error:'Only draft creation and cancellation are available.'},{status:400});
    return Response.json({order:body.action === 'create' ? await store.create(body) : await store.cancel(body)});
  } catch (error) {return failure(error);}
}
export const GET = withCompanyRoute('purchasing',handleGET);
export const POST = withCompanyRoute('purchasing',handlePOST);
