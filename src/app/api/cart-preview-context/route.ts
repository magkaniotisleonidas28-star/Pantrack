import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {withCompanyRoute} from '@/lib/authorization';
import {D1PurchaseOrderDrafts} from '@/lib/d1-purchase-order-drafts';
import {PurchaseOrderError} from '@/lib/purchase-order-contract';
import {z} from 'zod';

const input=z.object({companyId:z.string().min(1).max(200),orderId:z.string().min(1).max(200)}).strict();
export const POST=withCompanyRoute('purchasing',async(req:Request)=>{
  if((env as unknown as {PANTRACK_CART_PREVIEW?:string}).PANTRACK_CART_PREVIEW!=='enabled'||new URL(req.url).hostname!=='127.0.0.1')return Response.json({error:'Cart preview is off.'},{status:404});
  const parsed=input.safeParse(await req.json());if(!parsed.success)return Response.json({error:'Choose a draft.'},{status:400});
  const actor=(await getChatGPTUser())!.userId;
  try{
    const order=await new D1PurchaseOrderDrafts(database(),{identity:async()=>actor}).get(parsed.data.companyId,parsed.data.orderId);
    return Response.json({actor,order});
  }catch(e){return Response.json({error:e instanceof PurchaseOrderError?e.message:'Could not read draft.'},{status:e instanceof PurchaseOrderError&&e.code==='missing'?404:409});}
});
