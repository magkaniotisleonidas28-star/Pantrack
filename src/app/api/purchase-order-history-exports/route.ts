import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PurchaseOrderHistoryExports} from '@/lib/d1-purchase-order-history-exports';
import {PurchaseOrderHistoryExportError,purchaseOrderHistoryExportQuery} from '@/lib/purchase-order-history-export-contract';

async function handleGET(req:Request){
  if((env as unknown as {PANTRACK_PO_DRAFT_PREVIEW?:string}).PANTRACK_PO_DRAFT_PREVIEW!=='enabled')return Response.json({error:'Purchase-order draft preview is off.'},{status:404});
  try{
    if(req.url.length>8192)return Response.json({error:'History export filters are too large.'},{status:400});
    const selection=purchaseOrderHistoryExportQuery(new URL(req.url).searchParams);
    const store=new D1PurchaseOrderHistoryExports(database(),{identity:async()=>(await getChatGPTUser())?.userId??null});
    return Response.json({history:await store.get(selection)});
  }catch(error){
    if(error instanceof PurchaseOrderHistoryExportError)return Response.json({error:error.message,code:error.code},{status:
      error.code==='invalid_request'?400:error.code==='forbidden'?403:error.code==='empty'?404:error.code==='changed'?409:error.code==='too_large'?413:503});
    return Response.json({error:'Saved history could not be exported. Refresh the results and review the drafts.'},{status:503});
  }
}
const authorizedGET=withCompanyRoute('purchasing',handleGET);
export async function GET(req:Request){
  const response=await authorizedGET(req);response.headers.set('Cache-Control','private, no-store');response.headers.set('Pragma','no-cache');
  response.headers.set('X-Content-Type-Options','nosniff');return response;
}
