import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {a8ReviewPolicy} from '@/lib/a8-review-source';
import {authenticateCartWorker,cartWorkerService,workerQuerySchema,workerRequestSchema,workerView,workerMutationView,WorkerAuthenticationError} from '@/lib/po-cart-worker-transport';
import {PoCartJobError} from '@/lib/po-cart-job-contract';
import {PoCartAuthorizationError} from '@/lib/po-cart-authorization-contract';
import {CartPreparationError} from '@/lib/po-cart-preparation-contract';
import {PurchaseOrderError} from '@/lib/purchase-order-contract';
import {SupplierRegistryError} from '@/lib/purchasing-supplier-contract';

const LIMIT=32*1024;
function send(status:number,data:unknown){return Response.json(data,{status,headers:{'cache-control':'private, no-store','pragma':'no-cache','vary':'Authorization'}});}
function enabled(req:Request){const flags=env as unknown as Record<string,string|undefined>;
  return flags.PANTRACK_CART_PREVIEW==='enabled'&&flags.PANTRACK_CART_WORKER_TRANSPORT==='enabled'&&new URL(req.url).hostname==='127.0.0.1';}
async function body(req:Request){
  if(Number(req.headers.get('content-length'))>LIMIT)throw {status:413};
  const reader=req.body?.getReader();if(!reader)throw {status:400};
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT){await reader.cancel();throw {status:413};}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw {status:400};}
}
async function handle(req:Request){
  if(!enabled(req))return send(404,{error:'Worker transport unavailable.'});
  // This is a service boundary. Browser origins/preflights and ambient sessions confer no access.
  if(req.headers.has('origin')||req.headers.has('sec-fetch-site'))return send(403,{error:'Worker request required.'});
  try{
    const db=database(),access=await authenticateCartWorker(db,req.headers.get('authorization'));
    const service=cartWorkerService(db,access,{salesPolicy:a8ReviewPolicy()});
    if(req.method==='GET'){
      const params=new URL(req.url).searchParams;
      if(new Set(params.keys()).size!==[...params.keys()].length)return send(400,{error:'Invalid query.'});
      const q=workerQuerySchema.safeParse(Object.fromEntries(params));if(!q.success)return send(400,{error:'Invalid query.'});
      const current=await service.getWorker(q.data.jobId);return send(200,{current:current?workerView(current):null});
    }
    if(!/^application\/json(?:;|$)/i.test(req.headers.get('content-type')??''))return send(400,{error:'JSON required.'});
    if(new URL(req.url).search)return send(400,{error:'Invalid query.'});
    const parsed=workerRequestSchema.safeParse(await body(req));if(!parsed.success)return send(400,{error:'Invalid worker operation.'});
    const {action,...intent}=parsed.data,input={...intent,companyId:access.companyId};
    return send(200,workerMutationView(await service[action](input)));
  }catch(e){
    if(e instanceof WorkerAuthenticationError)return send(401,{error:'Worker authentication failed.'});
    if(e&&typeof e==='object'&&'status' in e&&(e.status===400||e.status===413))return send(e.status,{error:e.status===413?'Request too large.':'Invalid JSON.'});
    if(e instanceof PoCartJobError||e instanceof PoCartAuthorizationError||e instanceof CartPreparationError||e instanceof PurchaseOrderError||e instanceof SupplierRegistryError){
      const status=e.code==='missing'?404:e.code==='invalid_request'?400:e.code==='forbidden'?403:e.code==='storage_failure'?503:409;
      return send(status,{error:status===404?'Preparation job unavailable.':status===503?'Retry the same operation.':'Worker operation rejected.'});
    }
    return send(503,{error:'Temporary failure. Retry the same operation.'});
  }
}
export const GET=handle;
export const POST=handle;
export const OPTIONS=()=>send(403,{error:'Worker request required.'});
