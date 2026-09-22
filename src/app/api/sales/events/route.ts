import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {d1SalesService,localUserActor} from '@/lib/d1-sales-runtime';
import {D1SalesCorrectionService} from '@/lib/d1-sales-corrections';
import {exactInventoryPreviewEnabled} from '@/lib/exact-inventory-gate';
import {SalesIngestionError} from '@/lib/sales-ingestion';
import {z} from 'zod';

const id=z.string().min(1).max(200),reason=z.string().trim().min(1).max(500);
const mutation=z.discriminatedUnion('action',[
 z.object({companyId:id,action:z.literal('retry'),eventKey:id,reason}).strict(),
 z.object({companyId:id,action:z.literal('replay'),eventKey:id,reason}).strict(),
 z.object({companyId:id,action:z.literal('dismiss'),eventKey:id,reason}).strict(),
 z.object({companyId:id,action:z.literal('confirmOccurrence'),eventKey:id,occurredAt:z.string().min(20).max(35),reason}).strict(),
 z.object({companyId:id,action:z.literal('dismissConflict'),conflictId:id,reason}).strict(),
 z.object({companyId:id,action:z.literal('requestCorrection'),eventKey:id,reason}).strict(),
 z.object({companyId:id,action:z.literal('applyCorrection'),correctionId:id,items:z.array(z.object({productId:id,minor:z.string().regex(/^-?(?:0|[1-9]\d*)$/).max(20)}).strict()).min(1).max(100)}).strict(),
]);

async function handleGET(req:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Please sign in.'},{status:401});
 const url=new URL(req.url),companyId=url.searchParams.get('companyId'),member=await companyAccess(user.userId,companyId);if(!member)return Response.json({error:'Company access denied.'},{status:403});
 if(!exactInventoryPreviewEnabled())return Response.json({enabled:false,events:[],conflicts:[],corrections:[]});
 const db=database(),actor=localUserActor(user,companyId!,member.role);
 const eventKey=url.searchParams.get('eventKey');
 if(eventKey){const service=d1SalesService(db),event=await service.readStatus(companyId!,eventKey,actor),history=await service.readHistory(companyId!,eventKey,actor,50);return Response.json({enabled:true,event,history:member.role==='employee'?history.map(item=>({...item,reason:null})):history},{headers:{'Cache-Control':'no-store'}});}
 const [events,conflicts,corrections]=await Promise.all([
  d1SalesService(db).listStatus(companyId!,actor,50),
  db.prepare(`SELECT c.conflict_id,c.canonical_event_key,c.received_at,c.reason,
    CASE WHEN r.conflict_id IS NULL THEN 0 ELSE 1 END AS resolved FROM sales_event_conflicts c
    LEFT JOIN sales_event_conflict_resolutions r ON r.company_id=c.company_id AND r.conflict_id=c.conflict_id
    WHERE c.company_id=? ORDER BY c.received_at DESC LIMIT 50`).bind(companyId).all<{conflict_id:string;canonical_event_key:string;received_at:string;reason:string;resolved:number}>(),
  new D1SalesCorrectionService(db).list(companyId!,50),
 ]);
 const safeCorrections=corrections.map(correction=>member.role==='employee'
  ?{correctionId:correction.correctionId,eventKey:correction.eventKey,status:correction.status,reason:'Manager correction review',items:[]}
  :{...correction,requestedBy:undefined,result:correction.result?{...correction.result,confirmedBy:undefined}:null});
 return Response.json({enabled:true,events,conflicts:conflicts.results.map(row=>({conflictId:row.conflict_id,eventKey:row.canonical_event_key,receivedAt:row.received_at,reason:row.reason,resolved:Boolean(row.resolved)})),corrections:safeCorrections},{headers:{'Cache-Control':'no-store'}});
}

async function handlePOST(req:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Please sign in.'},{status:401});
 if(!exactInventoryPreviewEnabled())return Response.json({error:'Sales event processing is disabled.'},{status:404});
 try{
  const body=mutation.parse(await req.json()),member=await companyAccess(user.userId,body.companyId);if(!member||!['owner','manager'].includes(member.role))return Response.json({error:'Owner or manager permission is required.'},{status:403});
  const db=database(),service=d1SalesService(db),actor=localUserActor(user,body.companyId,member.role),corrections=new D1SalesCorrectionService(db);
  if(body.action==='retry'){await service.retry(body.companyId,body.eventKey,actor,body.reason);return Response.json(await service.process(body.companyId,body.eventKey));}
  if(body.action==='replay'){await service.replay(body.companyId,body.eventKey,actor,body.reason);return Response.json(await service.process(body.companyId,body.eventKey));}
  if(body.action==='dismiss'){await service.dismiss(body.companyId,body.eventKey,actor,body.reason);return Response.json({ok:true});}
  if(body.action==='confirmOccurrence'){await service.confirmOccurrence(body.companyId,body.eventKey,actor,body.occurredAt,body.reason);return Response.json(await service.process(body.companyId,body.eventKey));}
  if(body.action==='dismissConflict')return Response.json({ok:true,resolution:await service.dismissConflict(body.companyId,body.conflictId,actor,body.reason)});
  const correctionActor={userId:user.userId,email:user.email,role:member.role as 'owner'|'manager'};
  if(body.action==='requestCorrection')return Response.json({ok:true,correction:await corrections.request(body.companyId,body.eventKey,correctionActor,body.reason)});
  return Response.json({ok:true,correction:await corrections.apply(body.companyId,body.correctionId,correctionActor,body.items)});
 }catch(error){
  if(error instanceof z.ZodError)return Response.json({error:'Check the requested sales action and required fields.'},{status:400});
  if(error instanceof SalesIngestionError){const status=error.code==='not_found'?404:['invalid_state','claim_conflict','stale_inventory'].includes(error.code)?409:400;return Response.json({error:error.message,code:error.code},{status});}
  return Response.json({error:'Could not update the sales event.'},{status:503});
 }
}
export const GET=withCompanyRoute('sales',handleGET);
export const POST=withCompanyRoute('sales',handlePOST);
