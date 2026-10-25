import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PurchaseOrderExports} from '@/lib/d1-purchase-order-exports';
import {PurchaseOrderError} from '@/lib/purchase-order-contract';

async function handleGET(req:Request){
  if((env as unknown as {PANTRACK_PO_DRAFT_PREVIEW?:string}).PANTRACK_PO_DRAFT_PREVIEW!=='enabled'){
    return Response.json({error:'Purchase-order draft preview is off.'},{status:404});
  }
  const params=new URL(req.url).searchParams,keys=[...params.keys()];
  if(req.url.length>2048||keys.length!==3||new Set(keys).size!==3||
    keys.some(key=>!['companyId','orderId','revision'].includes(key))||!/^[1-9]\d{0,15}$/.test(params.get('revision')??'')){
    return Response.json({error:'Choose a company, draft and current saved revision.'},{status:400});
  }
  try{
    const store=new D1PurchaseOrderExports(database(),{identity:async()=> (await getChatGPTUser())?.userId??null});
    return Response.json({export:await store.get({companyId:params.get('companyId'),orderId:params.get('orderId'),revision:Number(params.get('revision'))})});
  }catch(error){
    if(!(error instanceof PurchaseOrderError))throw error;
    return Response.json({error:error.message,code:error.code},{status:error.code==='forbidden'?403:error.code==='missing'?404:
      error.code==='invalid_request'?400:error.code==='storage_failure'?503:409});
  }
}
const authorizedGET=withCompanyRoute('purchasing',handleGET);
export async function GET(req:Request){
  const response=await authorizedGET(req);
  response.headers.set('Cache-Control','private, no-store');
  response.headers.set('Pragma','no-cache');
  response.headers.set('X-Content-Type-Options','nosniff');
  return response;
}
