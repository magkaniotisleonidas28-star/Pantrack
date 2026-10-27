import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {D1PoDraftSchedules} from '@/lib/d1-po-draft-schedules';
import {PoDraftScheduleError} from '@/lib/po-draft-schedule-contract';

// Weekly draft schedules for owners and managers in the fictional cart preview; off by default and local only.
function enabled(req:Request){return (env as unknown as {PANTRACK_CART_PREVIEW?:string}).PANTRACK_CART_PREVIEW==='enabled'
  &&new URL(req.url).hostname==='127.0.0.1';}
function service(){return new D1PoDraftSchedules(database(),{identity:async()=>(await getChatGPTUser())?.userId??null});}
function failure(error:unknown){
  if(error instanceof PoDraftScheduleError)return Response.json({error:error.message,code:error.code},{status:error.code==='forbidden'?403:error.code==='missing'?404:
    error.code==='invalid_request'?400:error.code==='storage_failure'?503:409});
  return Response.json({error:'Save outcome may be uncertain. Retry the same operation identity.',uncertain:true},{status:503});
}
export const GET=withCompanyRoute('purchasing',async(req:Request)=>{
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try {
    const params=new URL(req.url).searchParams,companyId=params.get('companyId')??'',orderId=params.get('orderId');
    return Response.json(orderId===null?await service().list(companyId):await service().origin(companyId,orderId),{headers:{'Cache-Control':'no-store'}});
  }
  catch(error){return failure(error);}
});
export const POST=withCompanyRoute('purchasing',async(req:Request)=>{
  if(!enabled(req))return Response.json({error:'Cart preview is off.'},{status:404});
  try {
    const body:unknown=await req.json(),action=body&&typeof body==='object'&&'action' in body?body.action:null;
    if(action==='save')return Response.json(await service().save(body));
    if(action==='pause'||action==='resume')return Response.json(await service().setStatus(body));
    return Response.json({error:'Choose save, pause or resume.'},{status:400});
  }catch(error){return failure(error);}
});
